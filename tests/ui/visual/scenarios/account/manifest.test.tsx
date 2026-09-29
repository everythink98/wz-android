import { fireEvent, render } from '../../../render';
import { createEmptyReaderData } from '@/domain/reader/readerData';
import { ReaderStyleProvider } from '@/ui/theme/ReaderStyleProvider';
import { createTheme } from '@/ui/theme/tokens';
import { accountVisualScenarios } from './manifest';

describe('account visual scenarios', () => {
  it('classifies every Account capability without rendering external authentication surfaces', () => {
    expect(Array.from(new Set(accountVisualScenarios.flatMap(({ capabilityIds }) => capabilityIds))).sort()).toEqual([
      'ACCOUNT-01',
      'ACCOUNT-02',
      'ACCOUNT-03',
      'ACCOUNT-04',
      'ACCOUNT-05'
    ]);
    expect(accountVisualScenarios.every(({ id }) => id.startsWith('account.'))).toBe(true);
    expect(accountVisualScenarios.find(({ id }) => id === 'account.webview.authentication')?.kind).toBe('device-only');
  });

  it.each([
    ['checking', 'light', '正在检测…'],
    ['checking', 'dark', '正在检测…'],
    ['result', 'light', '返回原页面'],
    ['result', 'dark', '返回原页面']
  ] as const)(
    'renders the %s verification state in %s with large text and no website',
    async (state, theme, action) => {
      const scenario = accountVisualScenarios.find(({ id }) => id === `account.verification.${state}`);
      expect(scenario?.kind).toBe('rendered');
      if (scenario?.kind !== 'rendered') throw new Error('Verification visual scene is missing');
      const settings = { ...createEmptyReaderData().settings, fontScale: 1.4, theme };
      const view = await render(
        <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>
          {scenario.render()}
        </ReaderStyleProvider>
      );
      expect(view.getByText('linux.do 安全验证')).toBeTruthy();
      expect(view.queryByTestId('mock-webview')).toBeNull();
      expect(view.getByRole('button', { name: action }).props.accessibilityState).toEqual({
        busy: state === 'checking',
        disabled: state === 'checking'
      });
      if (state === 'result') {
        expect(view.getByText('已恢复')).toBeTruthy();
        expect(view.getByText('请求已过期，请返回原页面重试。')).toBeTruthy();
      }
      await fireEvent.press(view.getByRole('button', { name: '关闭' }));
      expect(view.queryByText('linux.do 安全验证')).toBeNull();
      await view.unmount();
    }
  );

  it.each([
    ['nodeseek', 'light', 'NodeSeek 登录 / 验证'],
    ['nodeseek', 'dark', 'NodeSeek 登录 / 验证'],
    ['yaohuo', 'light', '妖火登录'],
    ['yaohuo', 'dark', '妖火登录']
  ] as const)('renders the %s login frame in %s with no website', async (site, theme, title) => {
    const scenario = accountVisualScenarios.find(({ id }) => id === `account.login.${site}.blocked`);
    expect(scenario?.kind).toBe('rendered');
    if (scenario?.kind !== 'rendered') throw new Error('Login visual scene is missing');
    const settings = { ...createEmptyReaderData().settings, fontScale: 1.4, theme };
    const view = await render(
      <ReaderStyleProvider value={{ settings, theme: createTheme(settings) }}>{scenario.render()}</ReaderStyleProvider>
    );
    expect(view.getByText(title)).toBeTruthy();
    expect(view.getByText('代理设置正在应用，请稍候再试。')).toBeTruthy();
    expect(view.getByRole('button', { name: '检测登录' })).toBeTruthy();
    expect(view.getByRole('button', { name: '刷新页面' })).toBeTruthy();
    expect(view.getByRole('button', { name: '填入已保存登录信息' })).toBeTruthy();
    expect(view.queryByTestId('mock-webview')).toBeNull();
    await fireEvent.press(view.getByRole('button', { name: '关闭' }));
    expect(view.queryByText(title)).toBeNull();
    await view.unmount();
  });
});
