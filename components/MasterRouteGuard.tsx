
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext'; // Assuming you have an AuthContext
import { getGame } from '../services/gameService'; // Assuming you have a function to get game data
import { Game } from '../types';

interface MasterRouteGuardProps {
  children: React.ReactElement;
}

const MasterRouteGuard: React.FC<MasterRouteGuardProps> = ({ children }) => {
  const { gameId } = useParams<{ gameId: string }>();
  const { currentUser, loading } = useAuth();
  const navigate = useNavigate();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    const checkAuthorization = async () => {
      if (loading) return; // Wait until user data is loaded

      if (!currentUser) {
        navigate('/'); // Redirect to login if not authenticated
        return;
      }

      if (!gameId) {
        navigate('/lobby'); // Redirect to lobby if no gameId is present
        return;
      }

      const gameData = await getGame(gameId);

      if (!gameData) {
        navigate('/lobby'); // Redirect if game doesn't exist
        return;
      }

      const userIsCreator = gameData.createdBy === currentUser.uid;
      const userIsSuperUser = currentUser.customClaims?.role === 'superuser';

      if (userIsCreator || userIsSuperUser) {
        setIsAuthorized(true);
      } else {
        navigate(`/player/${gameId}`); // Redirect to player view if not authorized
      }
    };

    checkAuthorization();
  }, [currentUser, gameId, loading, navigate]);

  return isAuthorized ? children : null; // Or a loading spinner
};

export default MasterRouteGuard;
