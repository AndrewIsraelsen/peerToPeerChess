// P2P Chess Game - Complete implementation in a single file

class P2PChessGame {
    constructor() {
        // Game state
        this.board = this.initializeBoard();
        this.currentPlayer = 'white';
        this.selectedSquare = null;
        this.gameHistory = [];
        this.capturedPieces = { white: [], black: [] };
        this.gameState = 'playing';
        this.kingPositions = { white: [7, 4], black: [0, 4] };
        this.canCastle = {
            white: { kingside: true, queenside: true },
            black: { kingside: true, queenside: true }
        };
        this.enPassantTarget = null;
        this.moveCount = 0;

        // P2P Connection state
        this.peerConnection = null;
        this.dataChannel = null;
        this.isHost = false;
        this.playerColor = null;
        this.isOnline = false;
        this.connectionState = 'offline'; // offline, connecting, connected, playing
        this.connectionTimeout = null;

        // Chess piece symbols
        this.pieceSymbols = {
            white: {
                king: '♔',
                queen: '♕',
                rook: '♖',
                bishop: '♗',
                knight: '♘',
                pawn: '♙'
            },
            black: {
                king: '♚',
                queen: '♛',
                rook: '♜',
                bishop: '♝',
                knight: '♞',
                pawn: '♟'
            }
        };

        this.setupEventListeners();
        this.renderBoard();
        this.updateConnectionStatus('offline');
    }

    initializeBoard() {
        const board = Array(8).fill(null).map(() => Array(8).fill(null));

        // Place white pieces
        board[7] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
        board[6] = Array(8).fill('pawn');

        // Place black pieces
        board[0] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
        board[1] = Array(8).fill('pawn');

        // Add color information
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (board[row][col]) {
                    board[row][col] = {
                        type: board[row][col],
                        color: row < 2 ? 'black' : 'white'
                    };
                }
            }
        }

        return board;
    }

    setupEventListeners() {
        // Game controls
        document.getElementById('create-game-btn').addEventListener('click', () => this.createGame());
        document.getElementById('join-game-btn').addEventListener('click', () => this.showJoinInterface());
        document.getElementById('new-game-btn').addEventListener('click', () => this.newGame());
        document.getElementById('resign-btn').addEventListener('click', () => this.resign());

        // Connection controls
        document.getElementById('connect-answer-btn').addEventListener('click', () => this.connectWithAnswer());
        document.getElementById('join-offer-btn').addEventListener('click', () => this.joinWithOffer());

        // Chat
        document.getElementById('send-chat-btn').addEventListener('click', () => this.sendChat());
        document.getElementById('chat-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChat();
        });
    }

    // ============ CHESS GAME LOGIC ============

    renderBoard() {
        const boardElement = document.getElementById('chess-board');
        boardElement.innerHTML = '';

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                square.className = `square ${(row + col) % 2 === 0 ? 'light' : 'dark'}`;
                square.dataset.row = row;
                square.dataset.col = col;

                const piece = this.board[row][col];
                if (piece) {
                    const pieceElement = document.createElement('div');
                    pieceElement.className = 'piece';
                    pieceElement.textContent = this.pieceSymbols[piece.color][piece.type];
                    square.appendChild(pieceElement);
                }

                square.addEventListener('click', (e) => this.handleSquareClick(row, col));
                boardElement.appendChild(square);
            }
        }

        this.updateTurnIndicator();
        this.renderCapturedPieces();
    }

    handleSquareClick(row, col) {
        // Check if it's player's turn in online mode
        if (this.isOnline && this.playerColor !== this.currentPlayer) {
            this.addMessage('Not your turn!', 'error');
            return;
        }

        if (this.selectedSquare) {
            const [selectedRow, selectedCol] = this.selectedSquare;

            if (selectedRow === row && selectedCol === col) {
                this.clearSelection();
                return;
            }

            if (this.isValidMove(selectedRow, selectedCol, row, col)) {
                const moveData = {
                    from: [selectedRow, selectedCol],
                    to: [row, col],
                    piece: this.board[selectedRow][selectedCol]
                };

                this.makeMove(selectedRow, selectedCol, row, col);
                this.clearSelection();
                this.switchTurn();

                // Send move to opponent if online
                if (this.isOnline && this.dataChannel && this.dataChannel.readyState === 'open') {
                    this.sendMessage('move', moveData);
                }
            } else {
                if (this.board[row][col] && this.board[row][col].color === this.currentPlayer) {
                    this.selectSquare(row, col);
                } else {
                    this.clearSelection();
                }
            }
        } else {
            if (this.board[row][col] && this.board[row][col].color === this.currentPlayer) {
                this.selectSquare(row, col);
            }
        }
    }

    selectSquare(row, col) {
        this.clearSelection();
        this.selectedSquare = [row, col];

        const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`);
        square.classList.add('selected');

        this.highlightPossibleMoves(row, col);
    }

    clearSelection() {
        this.selectedSquare = null;
        document.querySelectorAll('.square').forEach(square => {
            square.classList.remove('selected', 'possible-move');
        });
    }

    highlightPossibleMoves(row, col) {
        for (let targetRow = 0; targetRow < 8; targetRow++) {
            for (let targetCol = 0; targetCol < 8; targetCol++) {
                if (this.isValidMove(row, col, targetRow, targetCol)) {
                    const targetSquare = document.querySelector(`[data-row="${targetRow}"][data-col="${targetCol}"]`);
                    targetSquare.classList.add('possible-move');
                }
            }
        }
    }

    isValidMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        if (!piece || piece.color !== this.currentPlayer) return false;

        const targetPiece = this.board[toRow][toCol];
        if (targetPiece && targetPiece.color === piece.color) return false;

        if (!this.isPieceMovementValid(piece.type, fromRow, fromCol, toRow, toCol)) return false;

        // Check if move would put own king in check
        if (this.wouldMovePutKingInCheck(fromRow, fromCol, toRow, toCol)) return false;

        return true;
    }

    isPieceMovementValid(pieceType, fromRow, fromCol, toRow, toCol) {
        const rowDiff = toRow - fromRow;
        const colDiff = toCol - fromCol;

        switch (pieceType) {
            case 'pawn':
                return this.isValidPawnMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff);
            case 'rook':
                return this.isValidRookMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff);
            case 'knight':
                return this.isValidKnightMove(rowDiff, colDiff);
            case 'bishop':
                return this.isValidBishopMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff);
            case 'queen':
                return this.isValidQueenMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff);
            case 'king':
                return this.isValidKingMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff);
            default:
                return false;
        }
    }

    isValidPawnMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff) {
        const piece = this.board[fromRow][fromCol];
        const direction = piece.color === 'white' ? -1 : 1;
        const startRow = piece.color === 'white' ? 6 : 1;

        // Forward move
        if (colDiff === 0 && !this.board[toRow][toCol]) {
            if (rowDiff === direction) return true;
            if (fromRow === startRow && rowDiff === 2 * direction) return true;
        }

        // Capture
        if (Math.abs(colDiff) === 1 && rowDiff === direction) {
            if (this.board[toRow][toCol]) return true;
            // En passant
            if (this.enPassantTarget &&
                this.enPassantTarget[0] === toRow &&
                this.enPassantTarget[1] === toCol) {
                return true;
            }
        }

        return false;
    }

    isValidRookMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff) {
        if (rowDiff !== 0 && colDiff !== 0) return false;
        return this.isPathClear(fromRow, fromCol, toRow, toCol);
    }

    isValidKnightMove(rowDiff, colDiff) {
        return (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 1) ||
               (Math.abs(rowDiff) === 1 && Math.abs(colDiff) === 2);
    }

    isValidBishopMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff) {
        if (Math.abs(rowDiff) !== Math.abs(colDiff)) return false;
        return this.isPathClear(fromRow, fromCol, toRow, toCol);
    }

    isValidQueenMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff) {
        return this.isValidRookMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff) ||
               this.isValidBishopMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff);
    }

    isValidKingMove(fromRow, fromCol, toRow, toCol, rowDiff, colDiff) {
        if (Math.abs(rowDiff) <= 1 && Math.abs(colDiff) <= 1) return true;

        // Castling
        if (rowDiff === 0 && Math.abs(colDiff) === 2) {
            return this.canCastleMove(fromRow, fromCol, toRow, toCol);
        }

        return false;
    }

    isPathClear(fromRow, fromCol, toRow, toCol) {
        const rowStep = toRow > fromRow ? 1 : toRow < fromRow ? -1 : 0;
        const colStep = toCol > fromCol ? 1 : toCol < fromCol ? -1 : 0;

        let currentRow = fromRow + rowStep;
        let currentCol = fromCol + colStep;

        while (currentRow !== toRow || currentCol !== toCol) {
            if (this.board[currentRow][currentCol]) return false;
            currentRow += rowStep;
            currentCol += colStep;
        }

        return true;
    }

    canCastleMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        if (piece.type !== 'king') return false;

        const isKingside = toCol > fromCol;
        const rookCol = isKingside ? 7 : 0;
        const rookPiece = this.board[fromRow][rookCol];

        if (!rookPiece || rookPiece.type !== 'rook' || rookPiece.color !== piece.color) return false;

        const castlingRights = this.canCastle[piece.color];
        if (!castlingRights[isKingside ? 'kingside' : 'queenside']) return false;

        if (!this.isPathClear(fromRow, fromCol, fromRow, rookCol)) return false;

        // Check if king passes through check
        const step = isKingside ? 1 : -1;
        for (let col = fromCol; col !== toCol + step; col += step) {
            if (this.wouldSquarePutKingInCheck(fromRow, col, piece.color)) return false;
        }

        return true;
    }

    wouldMovePutKingInCheck(fromRow, fromCol, toRow, toCol) {
        const originalPiece = this.board[toRow][toCol];
        const movingPiece = this.board[fromRow][fromCol];

        this.board[toRow][toCol] = movingPiece;
        this.board[fromRow][fromCol] = null;

        let kingRow, kingCol;
        if (movingPiece.type === 'king') {
            kingRow = toRow;
            kingCol = toCol;
        } else {
            [kingRow, kingCol] = this.kingPositions[movingPiece.color];
        }

        const inCheck = this.isKingInCheck(kingRow, kingCol, movingPiece.color);

        this.board[fromRow][fromCol] = movingPiece;
        this.board[toRow][toCol] = originalPiece;

        return inCheck;
    }

    wouldSquarePutKingInCheck(row, col, color) {
        const originalPiece = this.board[row][col];
        this.board[row][col] = { type: 'king', color: color };

        const inCheck = this.isKingInCheck(row, col, color);

        this.board[row][col] = originalPiece;

        return inCheck;
    }

    isKingInCheck(kingRow, kingCol, kingColor) {
        const enemyColor = kingColor === 'white' ? 'black' : 'white';

        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.color === enemyColor) {
                    if (this.isPieceMovementValid(piece.type, row, col, kingRow, kingCol)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    makeMove(fromRow, fromCol, toRow, toCol) {
        const piece = this.board[fromRow][fromCol];
        const capturedPiece = this.board[toRow][toCol];

        // Handle captures
        if (capturedPiece) {
            this.capturedPieces[capturedPiece.color].push(capturedPiece);
        }

        // Handle en passant capture
        if (piece.type === 'pawn' && this.enPassantTarget &&
            this.enPassantTarget[0] === toRow && this.enPassantTarget[1] === toCol) {
            const capturedPawnRow = piece.color === 'white' ? toRow + 1 : toRow - 1;
            const capturedPawn = this.board[capturedPawnRow][toCol];
            this.capturedPieces[capturedPawn.color].push(capturedPawn);
            this.board[capturedPawnRow][toCol] = null;
        }

        // Handle castling
        if (piece.type === 'king' && Math.abs(toCol - fromCol) === 2) {
            const isKingside = toCol > fromCol;
            const rookFromCol = isKingside ? 7 : 0;
            const rookToCol = isKingside ? toCol - 1 : toCol + 1;
            const rook = this.board[fromRow][rookFromCol];

            this.board[fromRow][rookToCol] = rook;
            this.board[fromRow][rookFromCol] = null;
        }

        // Make the move
        this.board[toRow][toCol] = piece;
        this.board[fromRow][fromCol] = null;

        // Update king position
        if (piece.type === 'king') {
            this.kingPositions[piece.color] = [toRow, toCol];
        }

        // Update castling rights
        if (piece.type === 'king') {
            this.canCastle[piece.color].kingside = false;
            this.canCastle[piece.color].queenside = false;
        } else if (piece.type === 'rook') {
            if (fromCol === 0) this.canCastle[piece.color].queenside = false;
            if (fromCol === 7) this.canCastle[piece.color].kingside = false;
        }

        // Update en passant target
        this.enPassantTarget = null;
        if (piece.type === 'pawn' && Math.abs(toRow - fromRow) === 2) {
            this.enPassantTarget = [(fromRow + toRow) / 2, toCol];
        }

        // Handle pawn promotion
        if (piece.type === 'pawn' && (toRow === 0 || toRow === 7)) {
            this.board[toRow][toCol] = { type: 'queen', color: piece.color };
        }

        this.moveCount++;
        this.gameHistory.push({
            from: [fromRow, fromCol],
            to: [toRow, toCol],
            piece: piece,
            captured: capturedPiece,
            moveCount: this.moveCount
        });
    }

    switchTurn() {
        this.currentPlayer = this.currentPlayer === 'white' ? 'black' : 'white';
        this.checkGameState();
        this.renderBoard();
    }

    checkGameState() {
        const kingPos = this.kingPositions[this.currentPlayer];
        const inCheck = this.isKingInCheck(kingPos[0], kingPos[1], this.currentPlayer);

        // Clear previous check highlighting
        document.querySelectorAll('.square').forEach(square => {
            square.classList.remove('in-check');
        });

        if (inCheck) {
            const square = document.querySelector(`[data-row="${kingPos[0]}"][data-col="${kingPos[1]}"]`);
            square.classList.add('in-check');

            if (this.isCheckmate()) {
                this.gameState = 'checkmate';
                const winner = this.currentPlayer === 'white' ? 'Black' : 'White';
                this.addMessage(`Checkmate! ${winner} wins!`, 'error');
            } else {
                this.gameState = 'check';
                this.addMessage(`${this.currentPlayer === 'white' ? 'White' : 'Black'} is in check!`, 'info');
            }
        } else if (this.isStalemate()) {
            this.gameState = 'stalemate';
            this.addMessage('Stalemate! The game is a draw.', 'info');
        }
    }

    isCheckmate() {
        return this.hasNoValidMoves() && this.isKingInCheck(
            this.kingPositions[this.currentPlayer][0],
            this.kingPositions[this.currentPlayer][1],
            this.currentPlayer
        );
    }

    isStalemate() {
        return this.hasNoValidMoves() && !this.isKingInCheck(
            this.kingPositions[this.currentPlayer][0],
            this.kingPositions[this.currentPlayer][1],
            this.currentPlayer
        );
    }

    hasNoValidMoves() {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                if (piece && piece.color === this.currentPlayer) {
                    for (let targetRow = 0; targetRow < 8; targetRow++) {
                        for (let targetCol = 0; targetCol < 8; targetCol++) {
                            if (this.isValidMove(row, col, targetRow, targetCol)) {
                                return false;
                            }
                        }
                    }
                }
            }
        }
        return true;
    }

    updateTurnIndicator() {
        const turnIndicator = document.getElementById('turn-indicator');
        const playerName = this.currentPlayer === 'white' ? 'White' : 'Black';
        turnIndicator.textContent = `${playerName}'s Turn`;

        if (this.isOnline) {
            const isMyTurn = this.currentPlayer === this.playerColor;
            turnIndicator.style.backgroundColor = isMyTurn ? 'rgba(11, 232, 129, 0.2)' : 'rgba(255, 107, 107, 0.2)';
            turnIndicator.style.color = 'white';
            turnIndicator.textContent += isMyTurn ? ' (Your Turn)' : ' (Opponent\'s Turn)';
        } else {
            turnIndicator.style.backgroundColor = this.currentPlayer === 'white' ? '#fff' : '#333';
            turnIndicator.style.color = this.currentPlayer === 'white' ? '#333' : '#fff';
        }
    }

    renderCapturedPieces() {
        const whiteCaptured = document.getElementById('captured-white-pieces');
        const blackCaptured = document.getElementById('captured-black-pieces');

        whiteCaptured.innerHTML = '';
        blackCaptured.innerHTML = '';

        this.capturedPieces.white.forEach(piece => {
            const pieceElement = document.createElement('span');
            pieceElement.className = 'captured-piece';
            pieceElement.textContent = this.pieceSymbols.white[piece.type];
            whiteCaptured.appendChild(pieceElement);
        });

        this.capturedPieces.black.forEach(piece => {
            const pieceElement = document.createElement('span');
            pieceElement.className = 'captured-piece';
            pieceElement.textContent = this.pieceSymbols.black[piece.type];
            blackCaptured.appendChild(pieceElement);
        });
    }

    newGame() {
        this.board = this.initializeBoard();
        this.currentPlayer = 'white';
        this.selectedSquare = null;
        this.gameHistory = [];
        this.capturedPieces = { white: [], black: [] };
        this.gameState = 'playing';
        this.kingPositions = { white: [7, 4], black: [0, 4] };
        this.canCastle = {
            white: { kingside: true, queenside: true },
            black: { kingside: true, queenside: true }
        };
        this.enPassantTarget = null;
        this.moveCount = 0;

        document.getElementById('game-messages').innerHTML = '';
        document.querySelectorAll('.square').forEach(square => {
            square.classList.remove('in-check');
        });

        this.renderBoard();
        this.addMessage('New game started!', 'success');

        // Send new game to opponent if online
        if (this.isOnline && this.dataChannel && this.dataChannel.readyState === 'open') {
            this.sendMessage('newGame', {});
        }
    }

    resign() {
        if (this.isOnline && (!this.playerColor || this.gameState !== 'playing')) {
            this.addMessage('Cannot resign - not in an active game', 'error');
            return;
        }

        const winner = this.currentPlayer === 'white' ? 'Black' : 'White';
        this.addMessage(`${this.currentPlayer === 'white' ? 'White' : 'Black'} resigned. ${winner} wins!`, 'error');
        this.gameState = 'resigned';

        // Send resignation to opponent if online
        if (this.isOnline && this.dataChannel && this.dataChannel.readyState === 'open') {
            this.sendMessage('resign', { player: this.currentPlayer });
        }
    }

    // ============ P2P CONNECTION LOGIC ============

    async createGame() {
        try {
            this.updateConnectionStatus('connecting');
            this.isHost = true;
            this.playerColor = 'white';
            this.iceCandidates = [];

            // Create peer connection with TURN servers for better connectivity
            this.peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    // Free TURN servers for better NAT traversal
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ],
                iceCandidatePoolSize: 10,
                iceTransportPolicy: 'all'
            });

            // Create data channel
            this.dataChannel = this.peerConnection.createDataChannel('chess', {
                ordered: true
            });

            this.setupDataChannel();
            this.setupPeerConnection();

            // Create offer
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);

            // Wait for ICE gathering to complete
            await this.waitForICEGathering();

            // Display complete offer with ICE candidates for sharing
            document.getElementById('offer-code').value = JSON.stringify({
                type: 'offer',
                data: {
                    sdp: this.peerConnection.localDescription,
                    iceCandidates: this.iceCandidates
                }
            });
            this.showConnectionPanel('local-offer');
            this.showConnectionPanel('remote-answer');

            this.addMessage('Game created! Share the code with your opponent.', 'success');

        } catch (error) {
            console.error('Error creating game:', error);
            this.addMessage('Failed to create game: ' + error.message, 'error');
            this.updateConnectionStatus('offline');
        }
    }

    showJoinInterface() {
        this.hideAllConnectionPanels();
        this.showConnectionPanel('join-offer');
        this.addMessage('Paste the game code from your opponent.', 'info');
    }

    async joinWithOffer() {
        try {
            const offerInput = document.getElementById('offer-input').value.trim();
            if (!offerInput) {
                this.addMessage('Please paste the offer code', 'error');
                return;
            }

            this.updateConnectionStatus('connecting');
            this.isHost = false;
            this.playerColor = 'black';
            this.iceCandidates = [];

            const offerData = JSON.parse(offerInput);
            if (offerData.type !== 'offer') {
                throw new Error('Invalid offer format');
            }

            // Create peer connection with TURN servers for better connectivity
            this.peerConnection = new RTCPeerConnection({
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' },
                    { urls: 'stun:stun3.l.google.com:19302' },
                    { urls: 'stun:stun4.l.google.com:19302' },
                    // Free TURN servers for better NAT traversal
                    {
                        urls: 'turn:openrelay.metered.ca:80',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    },
                    {
                        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                        username: 'openrelayproject',
                        credential: 'openrelayproject'
                    }
                ],
                iceCandidatePoolSize: 10,
                iceTransportPolicy: 'all'
            });

            this.setupPeerConnection();

            // Handle data channel from host
            this.peerConnection.ondatachannel = (event) => {
                this.dataChannel = event.channel;
                this.setupDataChannel();
            };

            // Set remote description and add ICE candidates
            await this.peerConnection.setRemoteDescription(offerData.data.sdp);

            // Add remote ICE candidates with error handling
            for (const candidate of offerData.data.iceCandidates) {
                try {
                    await this.peerConnection.addIceCandidate(candidate);
                    console.log('Added ICE candidate:', candidate);
                } catch (error) {
                    console.warn('Failed to add ICE candidate:', error, candidate);
                }
            }

            // Create answer
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);

            // Wait for ICE gathering to complete
            await this.waitForICEGathering();

            // Display complete answer with ICE candidates for sharing
            document.getElementById('answer-code').value = JSON.stringify({
                type: 'answer',
                data: {
                    sdp: this.peerConnection.localDescription,
                    iceCandidates: this.iceCandidates
                }
            });

            this.hideAllConnectionPanels();
            this.showConnectionPanel('local-answer');

            this.addMessage('Joined game! Send the answer code back to your opponent.', 'success');

        } catch (error) {
            console.error('Error joining game:', error);
            this.addMessage('Failed to join game: ' + error.message, 'error');
            this.updateConnectionStatus('offline');
        }
    }

    async connectWithAnswer() {
        try {
            const answerInput = document.getElementById('answer-input').value.trim();
            if (!answerInput) {
                this.addMessage('Please paste the answer code', 'error');
                return;
            }

            const answerData = JSON.parse(answerInput);
            if (answerData.type !== 'answer') {
                throw new Error('Invalid answer format');
            }

            // Set remote description
            await this.peerConnection.setRemoteDescription(answerData.data.sdp);

            // Add remote ICE candidates with error handling
            for (const candidate of answerData.data.iceCandidates) {
                try {
                    await this.peerConnection.addIceCandidate(candidate);
                    console.log('Added ICE candidate:', candidate);
                } catch (error) {
                    console.warn('Failed to add ICE candidate:', error, candidate);
                }
            }

            this.hideAllConnectionPanels();
            this.addMessage('Connecting to opponent...', 'info');

        } catch (error) {
            console.error('Error connecting with answer:', error);
            this.addMessage('Failed to connect: ' + error.message, 'error');
        }
    }

    setupPeerConnection() {
        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('New ICE candidate:', event.candidate.type, event.candidate.address);
                this.iceCandidates.push(event.candidate);
            } else {
                console.log('ICE gathering completed');
            }
        };

        this.peerConnection.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', this.peerConnection.iceConnectionState);

            switch (this.peerConnection.iceConnectionState) {
                case 'checking':
                    this.addMessage('Establishing connection...', 'info');
                    // Set a timeout for connection attempts
                    if (!this.connectionTimeout) {
                        this.connectionTimeout = setTimeout(() => {
                            if (this.peerConnection && this.peerConnection.iceConnectionState === 'checking') {
                                this.addMessage('Connection timeout - please try again with a new game', 'error');
                                this.updateConnectionStatus('offline');
                                this.resetConnection();
                            }
                        }, 30000); // 30 second timeout
                    }
                    break;
                case 'connected':
                case 'completed':
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }
                    this.updateConnectionStatus('connected');
                    this.addMessage('Connected to opponent!', 'success');
                    this.hideAllConnectionPanels();
                    break;
                case 'disconnected':
                    this.updateConnectionStatus('connecting');
                    this.addMessage('Connection lost, attempting to reconnect...', 'error');
                    break;
                case 'failed':
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }
                    this.updateConnectionStatus('offline');
                    this.addMessage('Connection failed - your networks may be incompatible', 'error');
                    console.error('ICE connection failed. Try using a VPN or different network.');
                    this.resetConnection();
                    break;
                case 'closed':
                    if (this.connectionTimeout) {
                        clearTimeout(this.connectionTimeout);
                        this.connectionTimeout = null;
                    }
                    this.updateConnectionStatus('offline');
                    this.addMessage('Connection closed', 'error');
                    this.resetConnection();
                    break;
            }
        };

        this.peerConnection.onicegatheringstatechange = () => {
            console.log('ICE gathering state:', this.peerConnection.iceGatheringState);
            if (this.peerConnection.iceGatheringState === 'complete') {
                console.log(`ICE gathering completed with ${this.iceCandidates.length} candidates`);
            }
        };

        // Add connection state logging
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            if (this.peerConnection.connectionState === 'failed') {
                this.addMessage('Connection failed due to network issues', 'error');
            }
        };
    }

    // Helper method to wait for ICE gathering to complete
    waitForICEGathering() {
        return new Promise((resolve) => {
            if (this.peerConnection.iceGatheringState === 'complete') {
                resolve();
            } else {
                const checkState = () => {
                    if (this.peerConnection.iceGatheringState === 'complete') {
                        this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
                        resolve();
                    }
                };
                this.peerConnection.addEventListener('icegatheringstatechange', checkState);

                // Fallback timeout after 15 seconds (increased for complex networks)
                setTimeout(() => {
                    this.peerConnection.removeEventListener('icegatheringstatechange', checkState);
                    console.log('ICE gathering timeout, proceeding with available candidates');
                    resolve();
                }, 15000);
            }
        });
    }

    setupDataChannel() {
        this.dataChannel.onopen = () => {
            console.log('Data channel opened');
            this.isOnline = true;
            this.updateConnectionStatus('playing');
            this.updatePlayerNames();
            this.showChat();

            // Send initial greeting
            this.sendMessage('playerInfo', {
                color: this.playerColor,
                name: this.playerColor === 'white' ? 'White Player' : 'Black Player'
            });
        };

        this.dataChannel.onclose = () => {
            console.log('Data channel closed');
            this.isOnline = false;
            this.updateConnectionStatus('offline');
            this.hideChat();
        };

        this.dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleP2PMessage(message);
            } catch (error) {
                console.error('Error parsing P2P message:', error);
            }
        };

        this.dataChannel.onerror = (error) => {
            console.error('Data channel error:', error);
            this.addMessage('Communication error with opponent', 'error');
        };
    }

    handleP2PMessage(message) {
        switch (message.type) {
            case 'move':
                this.handleOpponentMove(message.data);
                break;
            case 'chat':
                this.addChatMessage('Opponent', message.data.text);
                break;
            case 'newGame':
                this.handleOpponentNewGame();
                break;
            case 'resign':
                this.handleOpponentResign(message.data);
                break;
            case 'playerInfo':
                this.handlePlayerInfo(message.data);
                break;
        }
    }

    handleOpponentMove(moveData) {
        const [fromRow, fromCol] = moveData.from;
        const [toRow, toCol] = moveData.to;

        // Validate the move (basic check)
        if (this.isValidMove(fromRow, fromCol, toRow, toCol)) {
            this.makeMove(fromRow, fromCol, toRow, toCol);
            this.clearSelection();
            this.switchTurn();
        } else {
            this.addMessage('Invalid move received from opponent', 'error');
        }
    }

    handleOpponentNewGame() {
        this.newGame();
        this.addMessage('Opponent started a new game', 'info');
    }

    handleOpponentResign(data) {
        const winner = data.player === 'white' ? 'Black' : 'White';
        this.addMessage(`Opponent resigned. ${winner} wins!`, 'success');
        this.gameState = 'resigned';
    }

    handlePlayerInfo(data) {
        const opponentColor = data.color === 'white' ? 'black' : 'white';
        document.getElementById(`${opponentColor}-player-name`).textContent = `${data.color === 'white' ? 'White' : 'Black'} Player (Opponent)`;
        document.getElementById(`${this.playerColor}-player-name`).textContent = `${this.playerColor === 'white' ? 'White' : 'Black'} Player (You)`;
    }

    sendMessage(type, data) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify({ type, data }));
        }
    }

    updateConnectionStatus(status) {
        this.connectionState = status;
        const indicator = document.getElementById('status-indicator');
        const text = document.getElementById('status-text');

        indicator.className = 'status-indicator ' + status;

        switch (status) {
            case 'offline':
                text.textContent = 'Offline';
                break;
            case 'connecting':
                text.textContent = 'Connecting...';
                break;
            case 'connected':
                text.textContent = 'Connected';
                break;
            case 'playing':
                text.textContent = 'Playing Online';
                break;
        }

        this.updatePlayerNames();
    }

    updatePlayerNames() {
        const whiteStatus = document.getElementById('white-status');
        const blackStatus = document.getElementById('black-status');

        if (this.isOnline) {
            whiteStatus.textContent = this.playerColor === 'white' ? 'You' : 'Opponent';
            blackStatus.textContent = this.playerColor === 'black' ? 'You' : 'Opponent';
        } else {
            whiteStatus.textContent = 'Local';
            blackStatus.textContent = 'Local';
        }
    }

    resetConnection() {
        if (this.connectionTimeout) {
            clearTimeout(this.connectionTimeout);
            this.connectionTimeout = null;
        }
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        this.isOnline = false;
        this.isHost = false;
        this.playerColor = null;
        this.hideAllConnectionPanels();
        this.hideChat();
    }

    // ============ UI HELPER METHODS ============

    showConnectionPanel(panelId) {
        document.getElementById(panelId).style.display = 'block';
    }

    hideConnectionPanel(panelId) {
        document.getElementById(panelId).style.display = 'none';
    }

    hideAllConnectionPanels() {
        ['local-offer', 'remote-answer', 'join-offer', 'local-answer'].forEach(id => {
            this.hideConnectionPanel(id);
        });
    }

    showChat() {
        document.getElementById('chat-panel').style.display = 'block';
    }

    hideChat() {
        document.getElementById('chat-panel').style.display = 'none';
    }

    sendChat() {
        const input = document.getElementById('chat-input');
        const message = input.value.trim();

        if (message && this.isOnline && this.dataChannel && this.dataChannel.readyState === 'open') {
            this.sendMessage('chat', { text: message });
            this.addChatMessage('You', message);
            input.value = '';
        }
    }

    addChatMessage(sender, message) {
        const chatMessages = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'chat-message';
        messageDiv.innerHTML = `<span class="sender">${sender}:</span> ${message}`;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    addMessage(message, type = 'info') {
        const messagesContainer = document.getElementById('game-messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;
        messageElement.textContent = message;
        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

// ============ UTILITY FUNCTIONS ============

function copyToClipboard(elementId) {
    const element = document.getElementById(elementId);
    element.select();
    element.setSelectionRange(0, 99999);

    try {
        document.execCommand('copy');
        game.addMessage('Copied to clipboard!', 'success');
    } catch (err) {
        // Fallback for modern browsers
        navigator.clipboard.writeText(element.value).then(() => {
            game.addMessage('Copied to clipboard!', 'success');
        }).catch(() => {
            game.addMessage('Failed to copy to clipboard', 'error');
        });
    }
}

// ============ INITIALIZE GAME ============

let game;

document.addEventListener('DOMContentLoaded', () => {
    game = new P2PChessGame();

    // Add some helpful messages
    game.addMessage('Welcome to P2P Chess!', 'success');
    game.addMessage('Click "Create Game" to host or "Join Game" to join an existing game.', 'info');
    game.addMessage('You can also play locally by just making moves on the board.', 'info');
});