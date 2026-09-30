// The ranger's situational lines. Jev picks the one that fits the moment by
// matching the game state against each `when`; the words themselves are all
// hand-written (fictional voice, real park facts), so nothing is generated.

export const RANGER_LINES = [
  // --- time of day & light ---------------------------------------------------
  { id: 'golden_hour', when: 'Late afternoon golden hour, low warm sun, hiker out in the open with a view.', text: 'Golden hour, hiker. Everything on the mountain goes amber for about twenty minutes. Find a view and just sit.' },
  { id: 'alpenglow', when: 'Sun has just set or is setting and the hiker can see the mountain.', text: 'Look at the summit right now. That pink glow after sunset is alpenglow. The snow holds the light after the valleys go dark.' },
  { id: 'dusk_headlamp', when: 'Dusk or getting dark and the hiker is still moving on the trail without a light on.', text: 'It is getting dark fast. Grab your flashlight, key 7, and stick to the trail. The meadows are easy to get turned around in.' },
  { id: 'night_walk', when: 'Night, hiker walking around, not at camp.', text: 'Night hiking, huh? Keep it slow. Lots of roots and loose rock out there, and the creeks sound closer than they are.' },
  { id: 'sunrise', when: 'Early morning around sunrise.', text: 'Morning, hiker. First light hits the summit before anything else. Worth watching the line of sun walk down the glaciers.' },
  { id: 'midday_heat', when: 'Middle of the day, sunny, hiker climbing or at high elevation.', text: 'Midday sun up high is no joke, even in September. Snow and ice bounce it right back at you. Sunscreen and water.' },
  { id: 'days_shorter', when: 'Autumn afternoon, hiker far from trailheads or deep in the backcountry.', text: 'Days are getting shorter this time of year. Sun is down by seven. Plan your way back before you run out of light.' },

  // --- sky & stars -------------------------------------------------------------
  { id: 'milky_way', when: 'Clear night sky, hiker stargazing or at camp after dark.', text: 'See that band running overhead? That is the Milky Way. Out here, far from Seattle, you get the whole thing.' },
  { id: 'summer_triangle', when: 'Evening or night, hiker looking at the stars.', text: 'Find the three brightest stars high up: Vega, Deneb and Altair. The Summer Triangle. It hangs on into the autumn evenings.' },
  { id: 'andromeda', when: 'Late night stargazing with a very dark sky.', text: 'Fun one: look toward the east for a faint smudge near the W of Cassiopeia. That is the Andromeda Galaxy, two and a half million light years away.' },
  { id: 'lenticular', when: 'Daytime, clouds near the summit, or the hiker can see the mountain clearly.', text: 'If the mountain puts on a smooth lens-shaped cloud cap, that is a lenticular. Locals say the mountain is wearing a hat. Usually means weather is coming.' },
  { id: 'mountain_out', when: 'Clear day and the summit is fully visible.', text: 'The mountain is out! That is what folks in Seattle say on days like this. Enjoy it, some weeks it hides the whole time.' },

  // --- the mountain ------------------------------------------------------------
  { id: 'volcano', when: 'Hiker near the mountain or looking at the summit, any time.', text: 'Easy to forget, but Rainier is an active volcano. About 5,600 years ago a collapse sent the Osceola Mudflow all the way to Puget Sound.' },
  { id: 'summit_height', when: 'Hiker is looking at the summit or at a high viewpoint.', text: 'Top of the mountain is 14,410 feet. Columbia Crest. Climbers usually take two days and leave camp around midnight.' },
  { id: 'most_glaciated', when: 'Hiker can see glaciers or is at high elevation above treeline.', text: 'Rainier carries more glacial ice than any other peak in the lower 48. Over two dozen named glaciers on that one mountain.' },
  { id: 'crevasses', when: 'Hiker is on or near snow or a glacier.', text: 'Careful on the ice. Crevasses hide under a thin snow bridge this late in the season. No rope, no partner, stay on the rock.' },
  { id: 'rockfall', when: 'Afternoon, hiker near glaciers, moraines or steep rock.', text: 'Hear that rumble? Rockfall off the glacier. Warm afternoons loosen everything. Don\'t linger under the moraine walls.' },
  { id: 'high_altitude', when: 'Hiker is very high up, above about 8,000 feet.', text: 'You are pretty high now. If you get a headache or feel woozy, that is the altitude. Slow down, drink water, head down if it gets worse.' },
  { id: 'lahar_sirens', when: 'Hiker in a valley or river bottom near a glacial river.', text: 'Those grey rivers are glacier melt. If you ever hear the lahar sirens down in the valley towns, head for high ground. We practise it every year.' },

  // --- meadows, trees, fall colour --------------------------------------------
  { id: 'fall_colour', when: 'Autumn, hiker in or near red and gold subalpine meadows.', text: 'All that red is huckleberry turning. Mountain ash goes orange, and the grasses cure to gold. Late September is the best week of the year up here.' },
  { id: 'stay_on_trail', when: 'Hiker walking off trail through a meadow.', text: 'Hey, try to stick to the trail through the meadows. The growing season up here is only a couple of months. One boot print can last years.' },
  { id: 'paradise_name', when: 'Hiker is in the Paradise area meadows.', text: 'Martha Longmire named this place in 1885. First look at the flowers and she said, oh, what a paradise. It stuck.' },
  { id: 'tree_islands', when: 'Hiker among clumps of small subalpine firs in a meadow.', text: 'Those little clumps of trees are subalpine fir and mountain hemlock. Tree islands. They huddle together against the snow.' },
  { id: 'old_growth', when: 'Hiker in a dense, low-elevation old-growth forest.', text: 'Down in the old growth, some of those Douglas firs and red cedars have been standing for a thousand years. Quietest place in the park.' },
  { id: 'wildflowers', when: 'Summer, hiker in flowering meadows.', text: 'Lupine, paintbrush, avalanche lilies. You picked the right season. The meadows only get about eight weeks to do all this.' },
  { id: 'huckleberries_bears', when: 'Autumn, hiker in huckleberry meadows or forest edges.', text: 'Black bears are gorging on huckleberries this time of year. Make a little noise on blind corners so you don\'t surprise one.' },

  // --- wildlife ------------------------------------------------------------------
  { id: 'marmot', when: 'Daytime, hiker in open rocky meadows or talus.', text: 'Hear that whistle? Hoary marmot. They post a lookout on a rock and yell at anything that moves. Don\'t feed them, no matter how cute.' },
  { id: 'pika', when: 'Hiker near boulder fields or talus slopes.', text: 'Listen for a tiny eep in the rocks. That is a pika, gathering hay for the winter. They don\'t hibernate, they just stockpile.' },
  { id: 'mountain_goats', when: 'Hiker on high ridges or cliffs, open views.', text: 'Scan the cliffs with your binoculars, key 6. Those white dots up high are mountain goats. They go places nothing else can.' },
  { id: 'elk_bugle', when: 'Autumn, dusk or evening, hiker in valleys, forest edges or meadows.', text: 'Elk are bugling this month. If you hear something that sounds like a rusty gate screaming, that is a bull elk. Give them room.' },
  { id: 'gray_jay', when: 'Hiker resting, eating, or at camp during the day.', text: 'If a grey bird lands right next to you, that is a Canada jay. Camp robbers, we call them. They will take your sandwich out of your hand.' },
  { id: 'ptarmigan', when: 'Hiker high above treeline on rock and snow.', text: 'Keep an eye out for ptarmigan up there. Mottled birds that sit so still they look like rocks. They turn white in winter.' },

  // --- water ---------------------------------------------------------------------
  { id: 'waterfall_safety', when: 'Hiker near a waterfall or fast creek.', text: 'Stay back from the edge by the falls. Those rocks are always wet and slick with algae. The water is barely above freezing.' },
  { id: 'glacial_lakes', when: 'Hiker at or near an alpine lake.', text: 'Most of these lakes sit in hollows the glaciers scooped out. Calm mornings are best if you want the mountain upside down in the water.' },
  { id: 'filter_water', when: 'Hiker by a lake or creek, energy low or has been hiking a long time.', text: 'Refill at the creek if you need to, but filter it. Clear doesn\'t mean clean, even up here.' },

  // --- the hiker ---------------------------------------------------------------
  { id: 'tired', when: 'Hiker energy is low or they have been hiking hard for a long time.', text: 'You sound beat, hiker. Find a flat spot, make camp with C, and cook something hot. The mountain will still be here.' },
  { id: 'very_tired', when: 'Hiker energy is very low, near exhaustion, still walking.', text: 'Seriously, stop and eat. That is how people get hurt out here, pushing on when they are running on empty. Camp, food, rest.' },
  { id: 'poles', when: 'Hiker climbing steep terrain without trekking poles.', text: 'Steep stretch ahead. Trekking poles, key 8, will save your knees on the way up and back down.' },
  { id: 'running', when: 'Hiker has been running for a while.', text: 'Easy there, speedy. You will see more if you slow down. And your legs will thank you tomorrow.' },
  { id: 'check_in', when: 'Quiet moment, nothing special happening, ranger has not spoken in a long while.', text: 'Just checking in, hiker. All quiet here at the station. How\'s the view on your end?' },
  { id: 'map_tip', when: 'Hiker seems to be wandering, far from places or off trail.', text: 'If you are not sure where you are, pull out the map, key 2, or press M for the big one. You can pick a spot and go straight there.' },
  { id: 'photo_tip', when: 'Hiker at a scenic viewpoint, lake or waterfall with good light.', text: 'That is a postcard right there. Press P to take a photo, the disposable camera is key 5.' },

  // --- camp -----------------------------------------------------------------------
  { id: 'camp_pitched', when: 'The hiker has just made camp.', text: 'Nice spot for a camp. Light the fire from the camp menu, E, and cook something before it gets cold.' },
  { id: 'fire_safety', when: 'Campfire is lit.', text: 'Keep that fire small and drown it before you sleep. In the real park, fires only go in campground fire rings. Up here we are pretending.' },
  { id: 'cooking', when: 'Hiker is cooking or has a fire going at dinner time.', text: 'Whatever you are cooking, I can almost smell it from the station. Save me some.' },
  { id: 'cold_night', when: 'Night at camp, autumn or high elevation.', text: 'It will drop near freezing tonight. Sleep with your water bottle in the bag so it doesn\'t ice up.' },
  { id: 'stargaze_invite', when: 'Clear night at camp, hiker not yet stargazing.', text: 'Clear sky tonight. Lie back and look up. Press G. I will keep the radio down.' },

  // --- history & lookouts -------------------------------------------------------------
  { id: 'lookouts', when: 'Hiker at or near a fire lookout, or on a high ridge with long views.', text: 'Four of the park\'s old fire lookouts still stand. Folks spent whole summers in them with a map, a radio and a firefinder. Sounds nice some days.' },
  { id: 'wonderland', when: 'Hiker on a long trail, anywhere in the backcountry.', text: 'You know the Wonderland Trail goes all the way around the mountain? 93 miles and about 22,000 feet of climbing. Most people take ten days or more.' },
  { id: 'muir_1888', when: 'Hiker in high meadows or looking up toward Camp Muir.', text: 'John Muir climbed the mountain in 1888 and called these meadows the most luxuriant subalpine gardens he ever saw. Hard to argue.' },
  { id: 'carbon_rainforest', when: 'Hiker in the Carbon River or Mowich area, or in a wet, mossy forest.', text: 'Up in the northwest corner it is practically rainforest. Moss on everything. The Carbon Glacier snout sits lower than any other in the lower 48.' },
];

// Canned small-talk replies for when the hiker radios something the ranger can't act on.
export const RANGER_REPLIES = {
  greeting: 'Hey there, hiker. Loud and clear. What can I do for you?',
  thanks: 'Anytime. That is what the radio is for.',
  how_are_you: 'Doing fine. Quiet day at the station, mostly watching the clouds build on the summit.',
  joke: 'Why don\'t mountains get cold? They wear snow caps. I have been saving that one all season.',
  weather: 'Forecast looks steady. If the mountain grows a lens-shaped cloud cap, that is your sign weather is on the way.',
  goodbye: 'Copy that. Have a good one out there. Station out.',
  compliment: 'Ha. You are making my day, hiker.',
  other: 'Copy. Not sure I can help with that one from the station, but I am here if you need directions.',
};
