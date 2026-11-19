import { useState } from 'react'

type Props = {
  placeholder?: string
  submitLabel: string
  disabled?: boolean
  rows?: number
  /** 允许返回任意值（含 Promise），组件只关心提交时机，不消费返回值。 */
  onSubmit: (text: string) => unknown
}

export default function FreeInput({
  placeholder,
  submitLabel,
  disabled,
  rows = 3,
  onSubmit,
}: Props) {
  const [value, setValue] = useState('')

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault()
        const text = value.trim()
        if (!text || disabled) return
        void onSubmit(text)
        setValue('')
      }}
    >
      <textarea
        value={value}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        className="w-full resize-y rounded-lg border border-neutral-300 bg-white p-3 text-sm outline-none focus:border-neutral-500 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900"
      />
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
