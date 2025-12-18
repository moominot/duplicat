
import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import PlayerView from './pages/PlayerView';
import MasterView from './pages/MasterView';
import ProjectorView from './pages/ProjectorView';
import SettingsView from './pages/SettingsView';
import NewLobbyView from './pages/NewLobbyView';
import OnlinePlayerView from './pages/OnlinePlayerView';
import MasterRegistration from './pages/MasterRegistration';
import AuthView from './pages/AuthView';

const App: React.FC = () => {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<AuthView />} />
        <Route path="/lobby" element={<NewLobbyView />} />
        <Route path="/player/:gameId" element={<PlayerView />} />
        <Route path="/master/:gameId" element={<MasterView />} />
        <Route path="/settings/:gameId" element={<SettingsView />} />
        <Route path="/projector/:gameId" element={<ProjectorView />} />
        <Route path="/jugadoronline" element={<OnlinePlayerView />} />
        <Route path="/master-registration" element={<MasterRegistration />} />
      </Routes>
    </HashRouter>
  );
};

export default App;
