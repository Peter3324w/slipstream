import { useEffect, useRef } from 'react'

interface Props {
  open: boolean
  hasBuffer: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Native modal focus trapping also protects the mobile player underneath it. */
export function StopConfirmation({ open, hasBuffer, onCancel, onConfirm }: Props): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      keepRef.current?.focus()
    } else if (!open && dialog.open) dialog.close()
    return () => { if (dialog.open) dialog.close() }
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="stop-confirmation"
      role="alertdialog"
      aria-labelledby="stop-confirmation-title"
      aria-describedby={hasBuffer ? 'stop-confirmation-description' : undefined}
      onKeyDown={(event) => { if (open) event.stopPropagation() }}
      onCancel={(event) => { event.preventDefault(); onCancel() }}
      onClose={onCancel}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}
    >
      <h2 id="stop-confirmation-title">Are you sure you want to stop watching?</h2>
      {hasBuffer && <p id="stop-confirmation-description">Your temporary buffer will be deleted.</p>}
      <div className="stop-confirmation-actions">
        <button className="btn stop-confirmation-stop" type="button" data-confirm-stop onClick={onConfirm}>
          Yes
        </button>
        <button ref={keepRef} className="btn" type="button" data-keep-watching onClick={onCancel}>
          No
        </button>
      </div>
    </dialog>
  )
}
