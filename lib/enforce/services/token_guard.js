const TOKEN_LIMIT = 100000;

export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

export function checkTokenLimit(currentTokens) {
  return currentTokens >= TOKEN_LIMIT;
}

export function circuitBreakerMessage() {
  return "Лимит сессии достигнут (100k токенов). Нажмите /new для старта свежей сессии. Состояние задачи сохранено.";
}
