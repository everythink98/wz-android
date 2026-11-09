import { expect, it } from 'vitest';
import { parseHtml } from '../../src/domain/forum/html';
import { createTopicEditTransport } from '../helpers/topicEditingTransport';

it('rejects a superseded edit form token without mutating the synthetic server record', async () => {
  const transport = createTopicEditTransport('yaohuo');
  const url = 'https://www.yaohuo.me/bbs/book_view_mod.aspx';
  const formToken = async () => {
    const html = await (await transport.fetcher(url)).text();
    return parseHtml(html).querySelector('input[name="token"]')!.getAttribute('value')!;
  };
  const first = await formToken();
  const current = await formToken();
  const before = { ...transport.state };
  const submit = (token: string) =>
    transport.fetcher(url, {
      method: 'POST',
      body: new URLSearchParams({ token, book_title: '更新标题', book_content: '更新正文' }).toString()
    });

  expect(await (await submit(first)).text()).toContain('token错误');
  expect(transport.state).toEqual(before);
  expect(await (await submit(current)).text()).toContain('修改成功');
  expect(transport.state).toMatchObject({ title: '更新标题', body: '更新正文' });
});
