

# Issues

1. In the ball and bricks example, other than the host, there's a glitch in the movement of the ball
    - The 2 computers are on the same LAN, and the delay is only 1~4 ms, so ball movement should be very smooth on all players
2. When I open a game invite on multiple tabs in the same browser and the same browser profile, I'm treated as different players
    - This is not the right behaviour


# Features

1. Can you differentiate how text boxes look between what users can vs can't change
    - this is for both the p3p2 server and client
2. Stop players from joining the same room with the same name? 
    - limit what characters can be used in the player's name?    
3. The "Play" button on the front page and "open" button in the room page should open a new tab
4. Make it so that everyone joins the game through the same game invite, including owner of the room
    - remove the option to join a game by providing the room URL in the p3p2 client
        - the p3p2 cient no longer needs this field
    - After this change, "remove a player" and "end the game" can only be done in the p3p2 server (and not in the p3p2 client UI) 
    - the room page no longer needs the copy URL function

