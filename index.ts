import { registerRootComponent } from 'expo';
import App from './App';
import { initializeDiagnosticFileLogging } from './src/diagnosticFileStore';

initializeDiagnosticFileLogging();
registerRootComponent(App);
