
import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import PlayerView from './pages/PlayerView';
import MasterView from './pages/MasterView';
import ProjectorView from './pages/ProjectorView';
import SettingsView from './pages/SettingsView';
import LobbyView from './pages/LobbyView';
import OnlinePlayerView from './pages/OnlinePlayerView';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<LobbyView />} />
        <Route path="/lobby" element={<LobbyView />} />
        <Route path="/player" element={<PlayerView />} />
        <Route path="/master" element={<MasterView />} />
        <Route path="/settings" element={<SettingsView />} />
        <Route path="/projector" element={<ProjectorView />} />
        <Route path="/jugadoronline" element={<OnlinePlayerView />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
