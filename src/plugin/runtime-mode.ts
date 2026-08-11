export type RuntimeMode = 'headless' | 'dashboard'

export function resolveRuntimeMode(value: string | undefined = process.env.ACS_MODE): RuntimeMode {
  return value?.toLowerCase() === 'headless' ? 'headless' : 'dashboard'
}
