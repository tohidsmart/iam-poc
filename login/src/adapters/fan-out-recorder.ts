import type { AuthEventRecorder } from "../ports/auth-event-recorder.js";

/** Sends each event to every recorder; one failing recorder does not stop the others. */
export function fanOut(...recorders: AuthEventRecorder[]): AuthEventRecorder {
  return {
    record(event, context) {
      for (const recorder of recorders) {
        try {
          recorder.record(event, context);
        } catch {
          // Recording is best-effort by contract.
        }
      }
    },
  };
}
