import { registerRootComponent } from 'expo';
import App from './App';
import { initializeDiagnosticFileLogging } from '@/platform/diagnostics/diagnosticFileStore';
import { installMessageNotificationHandler } from '@/platform/notifications/notificationSystem';
import '@/app/notificationBackgroundTask';

initializeDiagnosticFileLogging();
installMessageNotificationHandler();
registerRootComponent(App);
