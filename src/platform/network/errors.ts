import { REQUEST_CANCELED_MESSAGE } from './request';

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败';
}

export function isCanceledRequest(error: unknown) {
  return error instanceof Error && error.message === REQUEST_CANCELED_MESSAGE;
}
