import { z } from 'zod';
import { MAX_COMPOSER_MARKDOWN_LENGTH } from '@/domain/forum/structuredComposer';

export { MAX_COMPOSER_MARKDOWN_LENGTH };

const strictObject = <Shape extends z.ZodRawShape>(shape: Shape) => z.object(shape).strict();
export const MAX_COMPOSER_EMOJI_COUNT = 2000;
const composerSiteSchema = z.enum(['linuxdo', 'nodeseek']);
const composerModeSchema = z.enum(['rich', 'source']);
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
const discourseEmojiSchema = strictObject({ name: z.string().min(1).max(100), url: z.string().url().max(2048) });
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
  canUseStaffResults: z.boolean()
});

export const composerHostMessageSchema = z.discriminatedUnion('type', [
  strictObject({
    type: z.literal('INIT'),
    payload: strictObject({
      site: composerSiteSchema,
      intentKind: z.enum(['reply', 'edit-reply', 'private-message']),
      markdown: z.string().max(MAX_COMPOSER_MARKDOWN_LENGTH),
      pendingNodeSeekPolls: z.array(pendingPollSchema).max(20),
      mode: composerModeSchema,
      nodeSeekMemberId: z.string().regex(/^\d+$/).optional(),
      discourseEmoji: z.array(discourseEmojiSchema).max(MAX_COMPOSER_EMOJI_COUNT).default([]),
      theme: editorThemeSchema
    })
  }),
  strictObject({
    type: z.literal('COMMAND'),
    payload: z.discriminatedUnion('name', [
      strictObject({ name: z.literal('insert-markdown'), markdown: z.string().max(MAX_COMPOSER_MARKDOWN_LENGTH) }),
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
  strictObject({
    type: z.literal('REQUEST_SNAPSHOT'),
    payload: strictObject({ requestId: z.string().min(1).max(80) })
  }),
  strictObject({ type: z.literal('SET_THEME'), payload: editorThemeSchema }),
  strictObject({ type: z.literal('DESTROY') })
]);

export const composerEditorMessageSchema = z.discriminatedUnion('type', [
  strictObject({ type: z.literal('READY'), payload: strictObject({ revision: z.number().int().nonnegative() }) }),
  strictObject({
    type: z.literal('STATE_CHANGED'),
    payload: strictObject({
      revision: z.number().int().nonnegative(),
      mode: composerModeSchema,
      isEmpty: z.boolean(),
      canUndo: z.boolean(),
      canRedo: z.boolean()
    })
  }),
  strictObject({
    type: z.literal('SNAPSHOT'),
    payload: strictObject({ requestId: z.string().max(80).optional(), snapshot: snapshotSchema })
  }),
  strictObject({
    type: z.literal('REQUEST_HOST_ACTION'),
    payload: strictObject({
      requestId: z.string().min(1).max(80),
      action: z.enum([
        'upload-image',
        'load-linuxdo-templates',
        'use-linuxdo-template',
        'load-linuxdo-poll-capabilities'
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
