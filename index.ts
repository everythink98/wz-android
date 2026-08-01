import { registerRootComponent } from 'expo';
import App from './App';
import { initializeDiagnosticFileLogging } from '@/platform/diagnostics/diagnosticFileStore';

initializeDiagnosticFileLogging();
registerRootComponent(App);
