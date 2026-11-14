import type { ComposerHostMessage, composerEditorMessageSchema } from './structuredComposerBridge';

type Upload = { readonly id: string; readonly epoch: number };
type Submission = { readonly epoch: number };
type CommandPayload = Extract<ComposerHostMessage, { type: 'COMMAND' }>['payload'] & {
  uploadId: string;
  documentEpoch: number;
};
type CommandResult = Extract<
  ReturnType<typeof composerEditorMessageSchema.parse>,
  { type: 'UPLOAD_COMMAND_RESULT' }
>['payload'];
type PendingCommand = {
  readonly id: string;
  readonly epoch: number;
  readonly command: string;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

export function createComposerWriteOperations(publishSubmission: (submission: Submission | null) => void) {
  let submission: Submission | null = null;
  let upload: Upload | null = null;
  let command: PendingCommand | null = null;
  const cancelSubmission = () => {
    submission = null;
    publishSubmission(null);
  };
  const ownsSubmission = (request: Submission) => submission === request;
  const cancelCommand = () => {
    const pending = command;
    if (!pending) return;
    clearTimeout(pending.timer);
    command = null;
    pending.reject(new Error('编辑文档已变化'));
  };
  return {
    get submitting() {
      return submission !== null;
    },
    get upload() {
      return upload;
    },
    get pendingCommand(): Readonly<Pick<PendingCommand, 'id' | 'epoch' | 'command'>> | null {
      return command;
    },
    ownsSubmission,
    cancelSubmission,
    cancelCommand,
    claimSubmission(epoch: number) {
      if (submission) return null;
      const next: Submission = { epoch };
      submission = next;
      publishSubmission(next);
      return next;
    },
    releaseSubmission(request: Submission) {
      if (ownsSubmission(request)) cancelSubmission();
    },
    claimUpload(id: string, epoch: number) {
      if (upload?.epoch === epoch) throw new Error('请等待当前上传完成');
      const next: Upload = { id, epoch };
      upload = next;
      return next;
    },
    releaseUpload(request: Upload) {
      if (upload === request) upload = null;
    },
    sendCommand(payload: CommandPayload, send: (message: ComposerHostMessage) => void) {
      return new Promise<void>((resolve, reject) => {
        if (command) {
          reject(new Error('请等待当前上传准备完成'));
          return;
        }
        const next: PendingCommand = {
          id: payload.uploadId,
          epoch: payload.documentEpoch,
          command: payload.name,
          resolve,
          reject,
          timer: setTimeout(() => {
            if (command !== next) return;
            command = null;
            reject(new Error('编辑器未确认上传位置，请重试'));
          }, 1500)
        };
        command = next;
        send({ type: 'COMMAND', payload });
      });
    },
    commandResult(result: CommandResult, documentEpoch: number) {
      const pending = command;
      if (
        !pending ||
        pending.id !== result.uploadId ||
        pending.epoch !== result.documentEpoch ||
        pending.command !== result.command
      )
        return;
      clearTimeout(pending.timer);
      command = null;
      if (result.accepted && pending.epoch === documentEpoch) pending.resolve();
      else pending.reject(new Error('编辑器未接受上传位置，请退出预览后重试'));
    }
  };
}
