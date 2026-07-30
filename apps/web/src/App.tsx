import { BridgeProvider } from './bridge/BridgeContext';
import { AppShell } from './layout/AppShell';

export default function App() {
  return (
    <BridgeProvider>
      <AppShell />
    </BridgeProvider>
  );
}
