// Android resolves the .android.ts sibling. Other targets must not invent a browser identity.
export function getDefaultAndroidWebViewUserAgent(): Promise<string> {
  return Promise.reject(new Error('默认浏览器身份读取仅支持 Android'));
}
