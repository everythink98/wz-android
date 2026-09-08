import '@/platform/diagnostics/diagnosticBootstrap';
import { registerRootComponent } from 'expo';
import App from './App';
import { installMessageNotificationHandler } from '@/platform/notifications/notificationSystem';
import '@/app/notificationBackgroundTask';

installMessageNotificationHandler();
registerRootComponent(App);
