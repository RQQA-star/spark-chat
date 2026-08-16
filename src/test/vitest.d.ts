// 为 Vitest 提供 @testing-library/jest-dom 的 matcher 类型增强
// （toBeInTheDocument 等），使 tsc 在类型检查测试文件时识别这些断言。
import '@testing-library/jest-dom/vitest';
