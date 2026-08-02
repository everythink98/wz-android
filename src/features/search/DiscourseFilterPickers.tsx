import type { Dispatch, SetStateAction } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';
import type { Category, DiscourseTagOption, DiscourseUserOption } from '@/domain/forum/models';
import type { DiscourseSearchFilter, SourceSearchFilter } from '@/domain/forum/searchFilters';
import { androidRipple, type ReaderTheme } from '@/ui/theme/tokens';
import { AppButton, EmptyText, LoadingState, TOUCH_HIT_SLOP } from '@/ui/controls/AppControls';
import type { SearchStyles } from './styles';

export function DiscourseFilterPickers({
  categoryNames,
  categoryPickerVisible,
  categoryQuery,
  discourseDraft,
  filteredDiscourseCategories,
  onRetryTags,
  onRetryUsers,
  setCategoryPickerVisible,
  setCategoryQuery,
  setTagPickerVisible,
  setTagQuery,
  setUserPickerVisible,
  setUserQuery,
  styles,
  tagError,
  tagLoading,
  tagOptions,
  tagPickerVisible,
  tagQuery,
  theme,
  toggleTag,
  updateDraft,
  userError,
  userLoading,
  userOptions,
  userPickerVisible,
  userQuery
}: {
  categoryNames: ReadonlyMap<string, string>;
  categoryPickerVisible: boolean;
  categoryQuery: string;
  discourseDraft: DiscourseSearchFilter | null;
  filteredDiscourseCategories: Category[];
  onRetryTags: () => Promise<unknown>;
  onRetryUsers: () => Promise<unknown>;
  setCategoryPickerVisible: Dispatch<SetStateAction<boolean>>;
  setCategoryQuery: Dispatch<SetStateAction<string>>;
  setTagPickerVisible: Dispatch<SetStateAction<boolean>>;
  setTagQuery: Dispatch<SetStateAction<string>>;
  setUserPickerVisible: Dispatch<SetStateAction<boolean>>;
  setUserQuery: Dispatch<SetStateAction<string>>;
  styles: SearchStyles;
  tagError: string;
  tagLoading: boolean;
  tagOptions: DiscourseTagOption[];
  tagPickerVisible: boolean;
  tagQuery: string;
  theme: ReaderTheme;
  toggleTag: (name: string) => void;
  updateDraft: (partial: Partial<SourceSearchFilter>) => void;
  userError: string;
  userLoading: boolean;
  userOptions: DiscourseUserOption[];
  userPickerVisible: boolean;
  userQuery: string;
}) {
  return (
    <>
      <Modal
        transparent
        visible={tagPickerVisible}
        animationType="fade"
        onRequestClose={() => setTagPickerVisible(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭标签选择"
            style={styles.searchFilterBackdrop}
            onPress={() => setTagPickerVisible(false)}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <Text style={styles.searchFilterTitle}>选择标签</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭标签选择"
                hitSlop={TOUCH_HIT_SLOP}
                style={styles.searchInlineButton}
                onPress={() => setTagPickerVisible(false)}
              >
                <X size={18} color={theme.muted} strokeWidth={2} />
              </Pressable>
            </View>
            <View style={styles.searchFilterBodyInner}>
              <TextInput
                accessibilityLabel="搜索标签"
                style={styles.input}
                value={tagQuery}
                onChangeText={setTagQuery}
                placeholder="搜索站点标签"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="handled"
            >
              {tagLoading ? <LoadingState text="正在加载标签..." styles={styles} theme={theme} /> : null}
              {tagError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{tagError}</Text>
                  <AppButton
                    compact
                    label="重试标签候选"
                    variant="ghost"
                    styles={styles}
                    onPress={() => {
                      void onRetryTags();
                    }}
                  />
                </View>
              ) : null}
              {!tagLoading && !tagError && !tagOptions.length ? (
                <EmptyText text="没有匹配标签" styles={styles} />
              ) : null}
              {tagOptions.map((option) => {
                const selected = Boolean(discourseDraft?.tags.includes(option.name));
                return (
                  <Pressable
                    key={option.name}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`标签 ${option.name}`}
                    accessibilityState={{ checked: selected }}
                    android_ripple={androidRipple(theme.primarySoft)}
                    style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
                    onPress={() => toggleTag(option.name)}
                  >
                    <Text style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}>
                      {option.name}
                      {option.topicCount === undefined ? '' : ` · ${option.topicCount}`}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <View style={styles.searchFilterActions}>
              <AppButton
                compact
                label="完成"
                variant="primary"
                styles={styles}
                onPress={() => setTagPickerVisible(false)}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        transparent
        visible={categoryPickerVisible}
        animationType="fade"
        onRequestClose={() => setCategoryPickerVisible(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭分类选择"
            style={styles.searchFilterBackdrop}
            onPress={() => setCategoryPickerVisible(false)}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <Text style={styles.searchFilterTitle}>选择分类</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭分类选择"
                hitSlop={TOUCH_HIT_SLOP}
                style={styles.searchInlineButton}
                onPress={() => setCategoryPickerVisible(false)}
              >
                <X size={18} color={theme.muted} strokeWidth={2} />
              </Pressable>
            </View>
            <View style={styles.searchFilterBodyInner}>
              <TextInput
                accessibilityLabel="搜索分类"
                style={styles.input}
                value={categoryQuery}
                onChangeText={setCategoryQuery}
                placeholder="搜索分类"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="handled"
            >
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel="分类 全部分类"
                accessibilityState={{ checked: !discourseDraft?.category }}
                style={[styles.searchFilterOption, !discourseDraft?.category && styles.searchFilterOptionActive]}
                onPress={() => {
                  updateDraft({ category: '' });
                  setCategoryPickerVisible(false);
                }}
              >
                <Text
                  style={[
                    styles.searchFilterOptionText,
                    !discourseDraft?.category && styles.searchFilterOptionTextActive
                  ]}
                >
                  全部分类
                </Text>
              </Pressable>
              {filteredDiscourseCategories.map((category) => {
                const parentName = category.parentId ? categoryNames.get(category.parentId) : '';
                const label = parentName ? `${parentName} / ${category.name}` : category.name;
                const selected = discourseDraft?.category === category.id;
                return (
                  <Pressable
                    key={category.id}
                    accessibilityRole="radio"
                    accessibilityLabel={`分类 ${label}`}
                    accessibilityState={{ checked: selected }}
                    style={[styles.searchFilterOption, selected && styles.searchFilterOptionActive]}
                    onPress={() => {
                      updateDraft({ category: category.id });
                      setCategoryPickerVisible(false);
                    }}
                  >
                    <Text style={[styles.searchFilterOptionText, selected && styles.searchFilterOptionTextActive]}>
                      {label}
                      {category.readRestricted ? ' · 🔒' : ''}
                      {category.topicCount === undefined ? '' : ` · ${category.topicCount}`}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal
        transparent
        visible={userPickerVisible}
        animationType="fade"
        onRequestClose={() => setUserPickerVisible(false)}
      >
        <KeyboardAvoidingView behavior="height" style={styles.searchFilterModalRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="关闭作者选择"
            style={styles.searchFilterBackdrop}
            onPress={() => setUserPickerVisible(false)}
          />
          <View style={styles.searchFilterSheet}>
            <View style={styles.searchFilterHandle} />
            <View style={styles.searchFilterHeader}>
              <Text style={styles.searchFilterTitle}>选择发帖人</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="关闭作者选择"
                hitSlop={TOUCH_HIT_SLOP}
                style={styles.searchInlineButton}
                onPress={() => setUserPickerVisible(false)}
              >
                <X size={18} color={theme.muted} strokeWidth={2} />
              </Pressable>
            </View>
            <View style={styles.searchFilterBodyInner}>
              <TextInput
                accessibilityLabel="搜索作者"
                style={styles.input}
                value={userQuery}
                onChangeText={setUserQuery}
                placeholder="输入用户名"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <ScrollView
              style={styles.searchFilterBody}
              contentContainerStyle={styles.searchFilterBodyInner}
              keyboardShouldPersistTaps="handled"
            >
              {userLoading ? <LoadingState text="正在加载作者..." styles={styles} theme={theme} /> : null}
              {userError ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{userError}</Text>
                  <AppButton
                    compact
                    label="重试作者候选"
                    variant="ghost"
                    styles={styles}
                    onPress={() => {
                      void onRetryUsers();
                    }}
                  />
                </View>
              ) : null}
              {!userQuery.trim() ? <EmptyText text="输入用户名后选择" styles={styles} /> : null}
              {!userLoading && !userError && userQuery.trim() && !userOptions.length ? (
                <EmptyText text="没有匹配用户" styles={styles} />
              ) : null}
              {userOptions.map((user) => (
                <Pressable
                  key={user.id}
                  accessibilityRole="radio"
                  accessibilityLabel={`用户 ${user.username}`}
                  accessibilityState={{ checked: discourseDraft?.username === user.username }}
                  style={[
                    styles.searchFilterOption,
                    discourseDraft?.username === user.username && styles.searchFilterOptionActive
                  ]}
                  onPress={() => {
                    updateDraft({ username: user.username });
                    setUserPickerVisible(false);
                  }}
                >
                  <Text
                    style={[
                      styles.searchFilterOptionText,
                      discourseDraft?.username === user.username && styles.searchFilterOptionTextActive
                    ]}
                  >
                    {user.displayName && user.displayName !== user.username ? `${user.displayName} · ` : ''}@
                    {user.username}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
