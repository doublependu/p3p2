# You want to invite friends

To play a game with friends through p3p2 you need two things: the game, and a **room URL** from a p3p2 server.
Whoever runs the server (you, or a friend: [self-host.md](self-host.md)) makes rooms in its portal and hands out
their URLs.

## Getting a room

In the server's portal (its address, logged in with the owner's password):

1. **Game URL**: the address of the game you will play, as you open it in your browser.
2. **Room name**: what your friends will see.
3. **Create room**. The room's page shows its **room URL**. Keep it to yourself: it is the key to the room.

On the room's page you can also allow more sites for the same room, choose how many may join (16 by default),
and what happens when players' versions of the game differ.

## Inviting

1. Open the game, and its multiplayer window: the button with three players on it, in a corner, or the game's
   own (FRIENDS, say).
2. Paste the room URL, type your name, and press **Create a multiplayer game room for my friends**.
3. You get the **invite link**, with a QR code. Send the link (Copy, or Share on a phone), or let a friend
   next to you scan the code.

Whoever opens the link is asked *Join?*, and then is in the room with you. The invite link only lets people in:
it cannot host, remove anybody or end anything. It lasts 12 hours after the room empties.

If you reload the page, you are back in the room. Next time, paste the room URL again.

The room's page in the portal shows the same link from the moment the room is created, before anyone has hosted:
**Open** opens the game with it, in a new tab.

## Friends who come to the server

Instead of a link each time, friends can have the server's address (`https://p3p2.example.com/`) once. Whoever opens
it without logging in sees the rooms its owner put on its **front page**, each with its invite link, and **Play**
opens the game.

On the room's page in the portal, **On this server's front page** says how much of the room it shows:

- **Not shown**, which every room starts with. While no room is shown, the address is the log-in page, as before.
- **Shown, with the whole invite link**: anybody who has the server's address can join.
- **Shown, without the link's last 2, 3, 4 or 8 characters**: the game asks for them, and the friends who come
  that way type them. Fewer are easier to read out over the phone; more are harder to guess. The room's page shows
  them under the invite link, for you to pass on.

A room is on the front page only while it has an invite: from when it is created, or someone hosts, until 12 hours
after it empties, or **End session**. The front page never shows the room URL, the characters it leaves out, or who
is playing.

The characters left out are the end of the room's invite, so they change with it: **Renew invite**, **End
session**, the invite running out, and hiding more of the link or taking the room off the front page, which makes a
new invite. Showing more of it keeps the invite, and the links already sent.

Only games on p3p2 0.2 or later ask for the characters. A game on an older version opens as if there were no
invite: send those friends the whole link.

**Someone who keeps guessing.** A room takes ten wrong tries at its characters, and then one more every 6 minutes.
While somebody keeps trying, nobody new gets in through the room's invite, with the right characters or with the
whole link. The players in the room stay, and whoever has the room URL still gets in. The server's log says
`tried-out` when a room has no tries left. Show the room with its whole link, or take it off the front page, and its
invite works again: nothing is left to guess.

## While it runs

- **Who is there**: the window lists everybody, in the order they came. The room's page in the portal also shows
  who is connected, and who has not been heard from for a few seconds.
- **Removing someone**: as the one who came in with the room URL, you can remove a player (**Remove …** in the
  window, or **Kick** in the portal). They can come back with the invite, unless you renew it.
- **A new invite**: **Renew invite** on the room's page in the portal makes the old link stop working. For when it
  went somewhere it should not have.
- **Ending**: **End for everyone** in the window (**End session** in the portal) sends everybody out and closes
  the invite.
- **The host**: many games need one page to run what must run once (enemies, a ball, the clock). That is the first
  to join, and after them whoever has been there longest and is not away. It passes on by itself when the host
  leaves, reloads, or puts the game in the background.

## A world that is kept

Some games keep what the room built: what was picked up in a field, a town, the paint of a match. It is still
there when everybody has left, next week too. A room is for one game, the first played in it; another game is
turned away, and the owner can let another in from the portal. The room's owner can clear what it saved in the portal
(**Clear saved data**), or delete the room.

## When it does not work

- *That doesn't look like a room URL*: paste it from the portal, whole.
- *This room isn't set up for …*: the game's address is not the one the room was made for. Add it on the room's
  page in the portal (the address as the browser shows it, without the path).
- On a phone on the same Wi-Fi as a server on your own computer: use the computer's address on the network, not
  `localhost`, both for the game and for the server ([self-host.md](self-host.md#trying-it-on-your-own-machine-first)).
