
export const isDebugEnabled = (): boolean => {
  return localStorage.getItem('scrabble_debug_mode') === 'true';
};

export const setDebugEnabled = (enabled: boolean) => {
  localStorage.setItem('scrabble_debug_mode', String(enabled));
};

// Wrappers condicionals per a la consola
export const debugLog = (...args: any[]) => {
  if (isDebugEnabled()) console.log(...args);
};

export const debugWarn = (...args: any[]) => {
  if (isDebugEnabled()) console.warn(...args);
};

export const debugError = (...args: any[]) => {
  if (isDebugEnabled()) console.error(...args);
};

export const debugGroup = (...args: any[]) => {
  if (isDebugEnabled()) console.group(...args);
};

export const debugGroupEnd = () => {
  if (isDebugEnabled()) console.groupEnd();
};
