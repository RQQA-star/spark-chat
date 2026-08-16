// 测试用轻量桩：替换重型 @tdesign-react/chat（依赖 tdesign-web-components 链）。
// 仅暴露测试中实际用到的导出（ChatMarkdown），其余按需补充。
// 通过 vitest.config.ts frontend 项目的 resolve.alias 指向本文件，
// 使 ChatMessages 测试无需加载整条 web-components 依赖即可断言文本。
import type { ReactNode } from 'react';

export function ChatMarkdown({
  content,
}: {
  content?: string;
  [key: string]: unknown;
}): ReactNode {
  return content ?? '';
}

// 其余导出占位，避免其它文件误引时报 "is not exported"（测试中未用到）。
export const ChatBot = (props: { children?: ReactNode }): ReactNode => props.children ?? null;
export const ChatList = ChatBot;
export const ChatMessage = ChatBot;
export const ChatActionBar = ChatBot;
export const Attachments = ChatBot;
export const Filecard = ChatBot;
export const ChatLoading = ChatBot;
export const ChatSender = ChatBot;
export const ChatThinking = ChatBot;
export const ChatSearchContent = ChatBot;
export const ChatSuggestionContent = ChatBot;
export const useChat = () => ({});
export const useAgentToolcall = () => ({});
export const AgentStateProvider = ChatBot;
export const ToolCallRenderer = ChatBot;
export const ActivityRenderer = ChatBot;
