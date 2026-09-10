import { initializeDiagnosticFileLogging } from './diagnosticFileStore';
import { recordStartupPhase, setStartupTimingRecorder } from './startupTiming';
import { nativeDiagnosticJournal } from './nativeDiagnosticJournal';

// This side effect runs before App and background-task modules are evaluated.
initializeDiagnosticFileLogging();
setStartupTimingRecorder((phase) => nativeDiagnosticJournal()?.recordStartupPhase?.(phase));
recordStartupPhase('js-entry');
