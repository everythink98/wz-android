import { z } from 'zod';
import { MAX_COMPOSER_MARKDOWN_LENGTH } from '@/domain/forum/structuredComposer';

export { MAX_COMPOSER_MARKDOWN_LENGTH };

const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict();
export const MAX_COMPOSER_EMOJI_COUNT = 2000;
const composerSiteSchema = z.enum(['linuxdo', 'nodeseek']);
const composerModeSchema = z.enum(['rich', 'source']);
const composerToolbarActionSchema = z.enum([
  'emoji',
  'upload-image',
  'bold',
  'italic',
  'heading-0',
  'heading-1',
  'heading-2',
  'heading-3',
  'heading-4',
  'heading-5',
  'heading-6',
  'strike',
  'underline',
  'link',
  'quote',
  'code',
  'list',
  'ordered-list',
  'task-list',
  'code-block',
  'divider',
  'table',
  'poll',
  'stardust',
  'private',
  'templates',
  'format',
  'focus-editor',
  'more'
]);
const composerToolbarStateSchema = strictObject({
  blockquote: z.boolean(),
  bold: z.boolean(),
  bulletList: z.boolean(),
  code: z.boolean(),
  codeBlock: z.boolean(),
  heading: z.number().int().min(0).max(6),
  italic: z.boolean(),
  orderedList: z.boolean(),
  strike: z.boolean(),
  table: z.boolean(),
  taskList: z.boolean(),
  underline: z.boolean(),
  link: z.boolean(),
  imageBusy: z.boolean(),
  builder: z
    .enum([
      'link',
      'nodeseek-poll',
      'stardust',
      'linuxdo-poll',
      'private',
      'templates',
      'stickers',
      'emoji',
      'format',
      'more'
    ])
    .nullable(),
  mode: composerModeSchema
});
const pendingPollSchema = strictObject({
  localId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{16}$/),
  title: z.string().max(500),
  multiple: z.boolean(),
  isPublic: z.boolean(),
  options: z.array(z.string().min(1).max(500)).min(2).max(100),
  remoteId: z.string().regex(/^\d+$/).optional()
});
const validationIssueSchema = strictObject({
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(300),
  from: z.number().int().nonnegative().optional(),
  to: z.number().int().nonnegative().optional()
});
const snapshotSchema = strictObject({
  revision: z.number().int().nonnegative(),
  markdown: z.string().max(MAX_COMPOSER_MARKDOWN_LENGTH),
  mode: composerModeSchema,
  isEmpty: z.boolean(),
  validationIssues: z.array(validationIssueSchema).max(100),
  pendingNodeSeekPolls: z.array(pendingPollSchema).max(20)
});
const editorThemeSchema = strictObject({
  dark: z.boolean(),
  ink: z.string().max(40),
  muted: z.string().max(40),
  surface: z.string().max(40),
  surface2: z.string().max(40),
  line: z.string().max(40),
  primary: z.string().max(40),
  primarySoft: z.string().max(40),
  danger: z.string().max(40),
  fontScale: z.number().min(0.8).max(2)
});
const discourseEmojiSchema = strictObject({ name: z.string().min(1).max(100), url: z.url().max(2048) });
export const linuxDoPollCapabilitiesSchema = strictObject({
  groups: z
    .array(
      strictObject({
        id: z.number().int().positive(),
        name: z.string().min(1).max(100),
        displayName: z.string().min(1).max(100)
      })
    )
    .max(1000),
  canUseStaffResults: z.boolean(),
  maxOptions: z.number().int().positive().optional(),
  minTrust: z.number().int().nonnegative().optional(),
  defaultPublic: z.boolean().optional(),
  canCreate: z.boolean().optional()
});

export const composerHostMessageSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('INIT'),
    payload: strictObject({
      documentEpoch: z.number().int().nonnegative().optional(),
      site: composerSiteSchema,
      intentKind: z.enum(['reply', 'edit-reply', 'private-message', 'create-topic', 'edit-topic']),
      markdown: z.string().max(MAX_COMPOSER_MARKDOWN_LENGTH),
      pendingNodeSeekPolls: z.array(pendingPollSchema).max(20),
      mode: composerModeSchema,
      readOnly: z.boolean().optional(),
      nodeSeekMemberId: z.string().regex(/^\d+$/).optional(),
      discourseEmoji: z.array(discourseEmojiSchema).max(MAX_COMPOSER_EMOJI_COUNT).default([]),
      theme: editorThemeSchema
    })
  }),
  strictObject({
    type: z.literal('COMMAND'),
    payload: z.discriminatedUnion('name', [
      strictObject({
        name: z.literal('toolbar-action'),
        documentEpoch: z.number().int().nonnegative(),
        action: composerToolbarActionSchema
      }),
      strictObject({ name: z.literal('insert-markdown'), markdown: z.string().max(MAX_COMPOSER_MARKDOWN_LENGTH) }),
      strictObject({
        name: z.literal('begin-image-upload'),
        uploadId: z.string().min(1).max(80),
        documentEpoch: z.number().int().nonnegative()
      }),
      strictObject({
        name: z.literal('finish-image-upload'),
        uploadId: z.string().min(1).max(80),
        documentEpoch: z.number().int().nonnegative(),
        markdown: z.string().max(MAX_COMPOSER_MARKDOWN_LENGTH).optional()
      }),
      strictObject({ name: z.literal('focus') }),
      strictObject({ name: z.literal('blur') }),
      strictObject({ name: z.literal('undo') }),
      strictObject({ name: z.literal('redo') }),
      strictObject({
        name: z.literal('set-discourse-emoji'),
        discourseEmoji: z.array(discourseEmojiSchema).max(MAX_COMPOSER_EMOJI_COUNT)
      }),
      strictObject({
        name: z.literal('host-action-result'),
        requestId: z.string().min(1).max(80),
        result: z.unknown().optional(),
        error: z.string().max(300).optional()
      })
    ])
  }),
  strictObject({ type: z.literal('SET_MODE'), payload: strictObject({ mode: composerModeSchema }) }),
  strictObject({ type: z.literal('SET_READ_ONLY'), payload: strictObject({ readOnly: z.boolean() }) }),
  strictObject({
    type: z.literal('REQUEST_SNAPSHOT'),
    payload: strictObject({ requestId: z.string().min(1).max(80) })
  }),
  strictObject({ type: z.literal('SET_THEME'), payload: editorThemeSchema }),
  strictObject({ type: z.literal('DESTROY') })
]);

export const composerEditorMessageSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('TOOLBAR_STATE'),
    payload: strictObject({
      documentEpoch: z.number().int().nonnegative(),
      state: composerToolbarStateSchema
    })
  }),
  strictObject({
    type: z.literal('RETURN_TO_EDITOR'),
    payload: strictObject({ documentEpoch: z.number().int().nonnegative() })
  }),
  strictObject({
    type: z.literal('PANEL_CHANGED'),
    payload: strictObject({
      documentEpoch: z.number().int().nonnegative(),
      open: z.boolean(),
      layout: z.enum(['form', 'expression']).optional()
    })
  }),
  strictObject({
    type: z.literal('UPLOAD_COMMAND_RESULT'),
    payload: strictObject({
      uploadId: z.string().min(1).max(80),
      documentEpoch: z.number().int().nonnegative(),
      command: z.enum(['begin-image-upload', 'finish-image-upload']),
      accepted: z.boolean()
    })
  }),
  strictObject({ type: z.literal('USER_INTERACTION'), payload: strictObject({}) }),
  strictObject({
    type: z.literal('READY'),
    payload: strictObject({
      documentEpoch: z.number().int().nonnegative().optional(),
      revision: z.number().int().nonnegative()
    })
  }),
  strictObject({
    type: z.literal('STATE_CHANGED'),
    payload: strictObject({
      documentEpoch: z.number().int().nonnegative().optional(),
      revision: z.number().int().nonnegative(),
      mode: composerModeSchema,
      isEmpty: z.boolean(),
      canUndo: z.boolean(),
      canRedo: z.boolean()
    })
  }),
  strictObject({
    type: z.literal('SNAPSHOT'),
    payload: strictObject({
      documentEpoch: z.number().int().nonnegative().optional(),
      requestId: z.string().max(80).optional(),
      snapshot: snapshotSchema
    })
  }),
  strictObject({
    type: z.literal('REQUEST_HOST_ACTION'),
    payload: strictObject({
      requestId: z.string().min(1).max(80),
      action: z.enum([
        'preview-topic',
        'prepare-panel',
        'upload-image',
        'load-linuxdo-templates',
        'use-linuxdo-template',
        'load-linuxdo-poll-capabilities',
        'resolve-linuxdo-upload'
      ]),
      data: z.unknown().optional()
    })
  }),
  strictObject({
    type: z.literal('ERROR'),
    payload: strictObject({
      code: z.string().min(1).max(80),
      message: z.string().min(1).max(300),
      revision: z.number().int()
    })
  })
]);

export type ComposerHostMessage = z.infer<typeof composerHostMessageSchema>;
export type ComposerToolbarAction = z.infer<typeof composerToolbarActionSchema>;
export type ComposerToolbarState = z.infer<typeof composerToolbarStateSchema>;
