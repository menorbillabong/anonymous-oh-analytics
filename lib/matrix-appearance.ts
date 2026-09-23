export const MATRIX_DEFAULTS = {matrix_enabled: true, matrix_color: '#3de879'};

export function normalizeMatrixAppearance(value: {matrix_enabled?: unknown; matrix_color?: unknown} | null | undefined) {
  return {
    matrix_enabled: typeof value?.matrix_enabled === 'boolean' ? value.matrix_enabled : MATRIX_DEFAULTS.matrix_enabled,
    matrix_color: typeof value?.matrix_color === 'string' && /^#[0-9a-f]{6}$/i.test(value.matrix_color)
      ? value.matrix_color.toLowerCase() : MATRIX_DEFAULTS.matrix_color,
  };
}

export function matrixRenderBudget(width: number, height: number, pixelRatio: number) {
  const mobile = width <= 720;
  return {
    columns: Math.min(mobile ? 24 : 80, Math.ceil(Math.max(0, width) / (mobile ? 28 : 24))),
    trail: Math.min(20, Math.ceil(Math.max(0, height) / 18)),
    pixelRatio: Math.max(1, Math.min(mobile ? 1 : 1.5, pixelRatio || 1)),
    frameInterval: 1000 / (mobile ? 16 : 24),
  };
}
