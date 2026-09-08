import { initializeDiagnosticFileLogging } from './diagnosticFileStore';

// This side effect runs before App and background-task modules are evaluated.
initializeDiagnosticFileLogging();
