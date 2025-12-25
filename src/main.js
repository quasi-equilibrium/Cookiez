import { GameApp } from './game/GameApp.js';

// Entry point: keep this file small; main game logic lives in src/game/*
const canvas = document.getElementById('game');
const app = new GameApp({ canvas });
app.start();

