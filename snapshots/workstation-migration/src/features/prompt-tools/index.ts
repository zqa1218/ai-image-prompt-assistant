import * as React from 'react'
import { useWizard } from '../../lib/wizardStore.ts'
import PromptOutput from '../../components/PromptOutput.tsx'
import { createIterationUI } from './iteration-ui.js'
import { createLibraryUI } from './library-ui.js'

export const IterationPanel = createIterationUI(React, useWizard, PromptOutput)
export const PromptLibrary = createLibraryUI(React, useWizard)
