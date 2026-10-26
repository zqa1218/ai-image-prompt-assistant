import type { ComponentType } from 'react'
import type { WizardState } from '../../lib/wizardStore.ts'
export function createIterationUI(react: unknown, store: unknown, output: unknown): ComponentType<{state: WizardState; exportName: string}> & { Settings: ComponentType }
