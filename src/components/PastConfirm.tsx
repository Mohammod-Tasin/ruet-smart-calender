import { small } from './ui';

/**
 * The "Fix a past holiday" step. The server answers PAST_CONFIRM with the warning text (how many
 * series have a semester history that would be recalculated); the admin confirms and the same
 * request is sent again with `confirmPast: true`.
 */
export function PastConfirm({
  message,
  busy,
  onConfirm,
  onCancel,
}: {
  message: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alert"
      className="basis-full space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p>{message}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-md bg-amber-600 px-3 py-1 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Fix a past holiday'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={small}>
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Inside a form: the same warning, confirmed by pressing the form's own Save button again. */
export function PastNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      {message} Press &quot;Fix a past holiday&quot; to continue.
    </p>
  );
}
