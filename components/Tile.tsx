import React from 'react';
import { Tile as TileType } from '../types';

interface TileProps {
  tile: TileType;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  onClick?: () => void;
}

const Tile: React.FC<TileProps> = ({ tile, size = 'md', className = '', onClick }) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-base',
    md: 'w-10 h-10 text-base',
    lg: 'w-14 h-14 text-2xl font-bold',
    // Projecció 16:9 - Ajustem per a que les 7 fitxes ocupin tot l'ample disponible sense trencar
    // Usant vh assegurem que escali amb l'alçada de la franja inferior del projector
    xl: 'w-full h-full text-[3vh] font-bold', 
  };

  // Dynamic point size based on tile size
  // FIX: Augmentat significativament el tamany dels punts a la vista projector (xl)
  // De text-[0.8vh] a text-[1.4vh] per a millor llegibilitat
  const pointSizeClass = size === 'xl' ? 'text-[1.6vh] right-[0.4vh] bottom-[0.2vh] font-bold' : 'text-[0.6em] right-[2px] bottom-[1px]';

  return (
    <div
      onClick={onClick}
      className={`
        relative flex items-center justify-center 
        bg-[#FDE6BD] text-black font-bold rounded-sm shadow-[1px_2px_2px_rgba(0,0,0,0.3)] border border-[#e8d5b5]
        select-none transition-transform
        ${onClick ? 'cursor-pointer active:scale-95 hover:brightness-95' : ''}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      <span className="z-10 leading-none pb-[0.1em]">{tile.displayChar}</span>
      <span className={`absolute font-bold text-gray-800 leading-none ${pointSizeClass}`}>
        {tile.value}
      </span>
      {/* Visual indicator for blank tile */}
      {tile.isBlank && (
        <div className="absolute inset-0 border-2 border-green-400/70 rounded-sm pointer-events-none"></div>
      )}
    </div>
  );
};

export default Tile;