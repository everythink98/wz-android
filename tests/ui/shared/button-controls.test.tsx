import { Heart } from 'lucide-react-native';
import { AppButton, IconButton } from '@/ui/controls/ButtonControls';
import { fireEvent, render } from '../render';

describe('Button controls', () => {
  it('lets action labels wrap and exposes busy feedback on the same action', async () => {
    const label = '恢复本机阅读记录和收藏';
    const onPress = jest.fn();
    const view = await render(<AppButton label={label} loading={false} onPress={onPress} />);
    expect(view.getByText(label).props.numberOfLines).not.toBe(1);
    await fireEvent.press(view.getByRole('button', { name: label }));

    await view.rerender(<AppButton label={label} loading onPress={onPress} />);
    const busy = view.getByRole('button', { name: label, busy: true });
    expect(busy).toBeDisabled();
    await fireEvent.press(busy);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('announces an icon-only action selection and busy status together', async () => {
    const view = await render(<IconButton icon={Heart} iconOnly label="取消收藏" active loading onPress={jest.fn()} />);
    expect(view.getByRole('button', { name: '取消收藏', selected: true, busy: true })).toBeDisabled();
  });
});
