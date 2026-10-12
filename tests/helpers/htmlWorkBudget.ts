import { HTMLElement, TextNode, type Node } from 'node-html-parser';

export function withHtmlWorkBudget<T>(budget: number, run: () => T, root?: HTMLElement): { result: T; reads: number } {
  let reads = 0;
  let registering = false;
  const known = new WeakSet<Node>();
  const arrays = new WeakMap<Node[], Node[]>();
  const originalArrays = new WeakMap<Node[], Node[]>();
  const ownDescriptors: [Node, string, PropertyDescriptor][] = [];
  const prototypeDescriptors: [string, PropertyDescriptor][] = [];
  const tick = () => {
    if (!registering && ++reads > budget) throw new Error(`HTML processing exceeded ${budget} DOM reads`);
  };
  const instrumentArray = (nodes: Node[]) => {
    const original = originalArrays.get(nodes) || nodes;
    let proxy = arrays.get(original);
    if (!proxy) {
      proxy = new Proxy(original, {
        get(target, key, receiver) {
          if (key === 'length' || (typeof key === 'string' && /^\d+$/.test(key))) tick();
          return Reflect.get(target, key, receiver);
        }
      });
      arrays.set(original, proxy);
      originalArrays.set(proxy, original);
    }
    return proxy;
  };
  const register = (root: HTMLElement) => {
    const previous = registering;
    registering = true;
    try {
      const pending: Node[] = [root];
      while (pending.length) {
        const node = pending.pop()!;
        if (known.has(node)) continue;
        known.add(node);
        if (node instanceof HTMLElement) for (const child of node.childNodes) pending.push(child);
        for (const key of ['rawTagName', 'parentNode', 'childNodes']) {
          const descriptor = Object.getOwnPropertyDescriptor(node, key);
          if (!descriptor || !('value' in descriptor)) continue;
          ownDescriptors.push([node, key, descriptor]);
          Object.defineProperty(node, key, {
            configurable: descriptor.configurable,
            enumerable: descriptor.enumerable,
            get() {
              tick();
              return key === 'childNodes' ? instrumentArray(descriptor.value) : descriptor.value;
            },
            set(value) {
              descriptor.value = Array.isArray(value) ? originalArrays.get(value) || value : value;
              if (key === 'childNodes') {
                for (const child of descriptor.value) if (child instanceof HTMLElement) register(child);
              }
            }
          });
        }
      }
    } finally {
      registering = previous;
    }
  };
  for (const key of ['querySelector', 'querySelectorAll', 'getAttribute']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    if (!descriptor || typeof descriptor.value !== 'function') throw new Error(`Missing HTML method ${key}`);
    prototypeDescriptors.push([key, descriptor]);
    Object.defineProperty(HTMLElement.prototype, key, {
      ...descriptor,
      value(this: HTMLElement, ...args: unknown[]) {
        if (key === 'getAttribute') tick();
        else register(this);
        return Reflect.apply(descriptor.value, this, args);
      }
    });
  }
  try {
    if (root) register(root);
    const result = run();
    return { result, reads };
  } finally {
    for (const [node, key, descriptor] of ownDescriptors.reverse()) Object.defineProperty(node, key, descriptor);
    for (const [key, descriptor] of prototypeDescriptors) Object.defineProperty(HTMLElement.prototype, key, descriptor);
  }
}

export function withHtmlDecodedInputBudget<T>(budget: number, run: () => T) {
  const descriptor = Object.getOwnPropertyDescriptor(TextNode.prototype, 'text');
  if (!descriptor?.get) throw new Error('Expected the real TextNode text decoder');
  const decode = descriptor.get;
  let units = 0;
  Object.defineProperty(TextNode.prototype, 'text', {
    ...descriptor,
    get(this: TextNode) {
      units += this.rawText.length;
      if (units > budget) throw new Error(`HTML entity decoding exceeded ${budget} UTF-16 units`);
      return decode.call(this);
    }
  });
  try {
    return { result: run(), units };
  } finally {
    Object.defineProperty(TextNode.prototype, 'text', descriptor);
  }
}
