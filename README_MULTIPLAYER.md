# Gumdrop Gauntlet — Online Multiplayer

This version adds room-based online co-op for up to 8 players.

## Included
- `candy_obby_triple_spinner.html` — multiplayer-enabled game client.
- `multiplayer_server.js` — Node.js WebSocket + static-file server.
- `package.json` — server dependency/configuration.

## Run locally
1. Install Node.js 18+.
2. Put the three files in the same folder.
3. Open a terminal in that folder and run:
   ```bash
   npm install
   npm start
   ```
4. Open `http://localhost:8080`.
5. Click **Online Multiplayer → Create Room**.
6. Open the same address in another browser/device and choose **Online Multiplayer → Join**, then enter the room code.
7. The host clicks **Start Co-op**.

For testing on two devices on the same Wi-Fi, use the computer's LAN IP instead of `localhost` (for example `http://192.168.1.20:8080`) and allow port 8080 through the firewall if needed.

## Put it online
Deploy the folder to a Node-compatible host that supports WebSockets. The server serves the HTML and exposes `/ws`. If the site is HTTPS, the client automatically uses secure WebSockets (`wss`).

The included server keeps rooms in memory, so rooms disappear when the server restarts. No account system or database is required for this prototype.

## Multiplayer behavior
- Up to 8 players can share a room.
- Players see each other moving and jumping in real time.
- Everyone plays the same level.
- A level advances when every player currently in the room reaches the goal.
- If the host leaves, another player becomes host.
- The existing 100-level campaign and triple-spinner levels remain intact.
