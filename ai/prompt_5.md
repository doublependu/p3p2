



# Features

0. Check the commit on "update logo" introduced from a different claude session and make sure that it hasn't changed any function of p3p2 apart from the logo design. 
1. make the invite link available on the front page of a p3p2 server without login
    - so that player 1's friends can navigate to the p3p2 server of player 1 and go to these game rooms
    - perhaps protecting a room by hiding a few characters in the shared invite link
        - the invite link should still work: just need the user to input the missing characters in the p3p2 client UI
        - make it optional, 0, 2, 3, 4, 8, n
        - 0 means anyone with the link can join
        - n means the player needs to provide the missing characters in the p3p2 client UI to join
            - larger n: more secure
            - smaller n: more convenient
        - This way the URL of player 1's p3p2 server is the only things that needs to be shared
        - In the room page after login, generate the invite link automatically
            - and allow users to click on it to open the game in the new tab
2. By default, smooth should only interpolate but not extrapolate
    - confirm that this is by setting coast to 0 by default
3. when there's unread chat message, there should be a red dot on the p3p2 logo, showing the number of unread messages



