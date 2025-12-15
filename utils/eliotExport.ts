
import { GameState, PlayerMove, REVERSE_DIGRAPH_MAP } from '../types';
import { ROW_LABELS, COL_LABELS } from '../constants';

// Convert App coordinates (0-14) to Scrabble notation (e.g., H8 or 8H)
// Horizontal: Row letter + Col number (e.g., H8)
// Vertical: Col number + Row letter (e.g., 8H)
const getEliotCoord = (row: number, col: number, dir: 'H' | 'V'): string => {
    const rChar = ROW_LABELS[row];
    const cNum = COL_LABELS[col];
    return dir === 'H' ? `${rChar}${cNum}` : `${cNum}${rChar}`;
};

// Convert rack array to string (e.g., ["A", "?", "B"] -> "A?B")
// Handles digraphs conversion back to display format (e.g., 'Ł' -> 'L·L')
const formatRack = (rack: string[]): string => {
    return rack.map(c => {
        if (c === '?') return '?';
        const upper = c.toUpperCase();
        return REVERSE_DIGRAPH_MAP[upper] || upper;
    }).join('');
};

// Format word for Eliot: Blanks must be lowercase, normal letters uppercase.
// Digraphs (QU, NY, L·L) must be expanded from their internal char to their display string.
const formatWord = (move: PlayerMove): string => {
    return move.tiles.map(t => {
        const upperInternal = t.char.toUpperCase();
        // Get the display version (e.g., "QU" for "Û", "L·L" for "Ł")
        const display = REVERSE_DIGRAPH_MAP[upperInternal] || upperInternal;
        // If it's a blank, Eliot usually expects lowercase to signify 0 points
        return t.isBlank ? display.toLowerCase() : display;
    }).join('');
};

const escapeXml = (unsafe: string): string => {
    return unsafe.replace(/[<>&'"]/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
};

export const generateEliotXML = (gameState: GameState): string => {
    // Use history for completed rounds.
    const rounds: any[] = [
        ...gameState.history
    ].sort((a: any, b: any) => a.roundNumber - b.roundNumber);

    // Map participants to integer IDs (required by Eliot)
    // We sort by table number to keep it consistent
    const participants = Object.values(gameState.participants).sort((a, b) => {
        return (parseInt(a.tableNumber) || 0) - (parseInt(b.tableNumber) || 0);
    });

    // Total turns = history rounds + 1 final round for leftovers
    const totalTurns = rounds.length + 1;

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<EliotGame format="2">\n';
    
    // --- Dictionary ---
    xml += '    <Dictionary>\n';
    xml += '        <Name>DISC 2.17.24</Name>\n'; 
    xml += '        <Type>dawg</Type>\n';
    xml += '        <Letters>A B C Ç D E F G H I J L L·L M N NY O P QU R S T U V X Z ?</Letters>\n';
    xml += '    </Dictionary>\n';

    // --- Game Info ---
    xml += '    <Game>\n';
    xml += '        <Mode>arbitration</Mode>\n';
    
    // Players
    participants.forEach((p, index) => {
        xml += `        <Player id="${index}">\n`;
        xml += `            <Name>${escapeXml(p.name)}</Name>\n`;
        xml += `            <Type>human</Type>\n`;
        xml += `            <TableNb>${p.tableNumber}</TableNb>\n`;
        xml += `        </Player>\n`;
    });

    xml += `        <Turns>${totalTurns}</Turns>\n`;
    xml += '    </Game>\n';

    // --- History ---
    xml += '    <History>\n';

    rounds.forEach(round => {
        const rackStr = formatRack(round.rack);
        const masterMove = round.masterMove;

        xml += '        <Turn>\n';
        
        // Racks
        xml += `            <GameRack>${rackStr}</GameRack>\n`;
        
        // Player Racks
        participants.forEach((p, index) => {
            xml += `            <PlayerRack playerId="${index}">${rackStr}</PlayerRack>\n`;
        });

        // Moves
        const moves: PlayerMove[] = round.moves ? Object.values(round.moves) : [];
        
        participants.forEach((p, index) => {
            const pMove = moves.find(m => m.playerId === p.id);
            
            if (pMove) {
                const coord = getEliotCoord(pMove.row, pMove.col, pMove.direction);
                const word = formatWord(pMove);
                const moveType = pMove.isValid ? "valid" : "invalid";
                const score = pMove.score || 0;

                xml += `            <PlayerMove playerId="${index}" points="${score}" type="${moveType}" word="${word}" coord="${coord}" />\n`;
            } else {
                 xml += `            <PlayerMove playerId="${index}" points="0" type="none" />\n`;
            }
        });
        
        // Master Move (Placed just before GameMove)
        if (masterMove) {
            const coord = getEliotCoord(masterMove.row, masterMove.col, masterMove.direction);
            const word = formatWord(masterMove);
            xml += `            <MasterMove points="${masterMove.score}" type="valid" word="${word}" coord="${coord}" />\n`;
        } else {
            xml += `            <MasterMove points="0" type="none" />\n`;
        }

        // Game Move
        if (masterMove) {
             const coord = getEliotCoord(masterMove.row, masterMove.col, masterMove.direction);
             const word = formatWord(masterMove);
             xml += `            <GameMove points="${masterMove.score}" type="valid" word="${word}" coord="${coord}" />\n`;
        }

        xml += '        </Turn>\n';
    });

    // --- Final Turn (Leftovers) ---
    const finalRackStr = formatRack(gameState.currentRack || []);
    xml += '        <Turn>\n';
    xml += `            <GameRack>${finalRackStr}</GameRack>\n`;
    
    participants.forEach((p, index) => {
        xml += `            <PlayerRack playerId="${index}">${finalRackStr}</PlayerRack>\n`;
    });
    
    participants.forEach((p, index) => {
        xml += `            <PlayerMove playerId="${index}" points="0" type="none" />\n`;
    });
    
    xml += `            <MasterMove points="0" type="none" />\n`;
    
    xml += '        </Turn>\n';

    xml += '    </History>\n';
    
    xml += '</EliotGame>';
    
    return xml;
};
