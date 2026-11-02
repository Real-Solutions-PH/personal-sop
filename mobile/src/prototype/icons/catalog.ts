// The icons a person can give their own records (habits, routines, money
// categories). A record stores the emoji itself, so it reads the same in a
// notification, a chip or a Fern reply (ADR-0030). Each line is
// "emoji Name | search words": the name is the icon's VoiceOver label, the
// words are what search and suggestions match ("gym" finds the lifter).
// Keep every icon that was ever offered: saved records still point at it.

export interface IconEntry {
  emoji: string
  name: string
  /** Lower-case words from the name and the synonyms. */
  words: string[]
  section: string
}
export interface IconSection {
  id: string
  title: string
  icons: IconEntry[]
}

const RAW: [id: string, title: string, lines: string][] = [
  [
    "health",
    "Health",
    `💧 Water drop | water drink hydrate hydration glasses
💊 Pill | medicine meds medication vitamin vitamins supplement tablet health
💉 Syringe | injection vaccine shot insulin
🩺 Stethoscope | doctor checkup clinic appointment
🩹 Bandage | first aid wound plaster
🦷 Tooth | teeth floss flossing brush dentist dental
🪥 Toothbrush | brush teeth dental oral
🫀 Heart organ | cardio heart rate blood pressure
🫁 Lungs | breathe breathing respiratory
❤️‍🩹 Mending heart | recovery healing heal
🌡️ Thermometer | temperature fever sick
🩸 Drop of blood | blood period cycle donate glucose sugar
🦴 Bone | bones calcium joints posture
👁️ Eye | eyes vision eye drops contacts
👂 Ear | hearing listen
👃 Nose | allergy smell
🩻 X-ray | scan hospital
🏥 Hospital | clinic emergency
🚑 Ambulance | emergency
🚭 No smoking | quit smoking cigarette vape nicotine
🧪 Test tube | lab test blood test
🧬 DNA | genetics
😷 Face with mask | sick mask cold flu
🤧 Sneezing face | allergy allergies cold hayfever
🤒 Face with thermometer | sick ill fever
⚕️ Medical symbol | medical health
🦠 Microbe | germ virus wash hands hygiene
🦵 Leg | legs knee physio physiotherapy
🦶 Foot | feet steps
🧑‍⚕️ Health worker | doctor nurse
🦽 Wheelchair | mobility accessibility
🩼 Crutch | injury recovery`,
  ],
  [
    "fitness",
    "Fitness",
    `🏋️ Weight lifter | gym workout lift lifting weights strength training dumbbell barbell
💪 Flexed biceps | strength strong arms muscle gym workout pushups
🏃 Running | run runner jog jogging cardio marathon
🚶 Walker | walk walking steps stroll
👟 Running shoe | sneakers shoes trainers run steps
🎽 Running shirt | singlet race run
⏱️ Stopwatch | timer time interval hiit plank
🤸 Cartwheel | stretch stretching mobility flexibility gymnastics yoga
🧗 Climber | climbing bouldering climb
🚴 Cyclist | bike biking cycling ride bicycle spin
🚵 Mountain biker | mtb trail bike
🏊 Swimmer | swim swimming pool laps
🚣 Rower | row rowing kayak rowing machine
🛶 Canoe | kayak paddle
🏄 Surfer | surf surfing
⛷️ Skier | ski skiing
🏂 Snowboarder | snowboard
⛸️ Ice skate | skating
🛹 Skateboard | skate skating
🛼 Roller skate | skating rollerblade
🏀 Basketball | hoops ball
⛹️ Basketball player | basketball ball
⚽ Soccer ball | football futsal
🏈 American football | football
⚾ Baseball | softball
🎾 Tennis | padel pickleball racket
🏸 Badminton | shuttlecock racket
🏓 Ping pong | table tennis
🏐 Volleyball | beach volleyball
🥅 Goal net | goal
🥊 Boxing glove | boxing kickboxing muay thai punch
🥋 Martial arts uniform | karate judo taekwondo jiu jitsu bjj martial arts
🤼 Wrestlers | wrestling
🤺 Fencer | fencing
🏌️ Golfer | golf
⛳ Flag in hole | golf
🏇 Horse racing | riding equestrian
🪂 Parachute | skydive skydiving
🏹 Bow and arrow | archery
🏆 Trophy | win winner achievement champion award
🥇 Gold medal | first place win gold
🏅 Sports medal | medal race finisher`,
  ],
  [
    "food",
    "Food & drink",
    `🍽️ Plate and cutlery | food meal meals dinner lunch eat eating dining
🍗 Chicken leg | chicken dining out fried chicken poultry
🥗 Green salad | salad healthy veggies vegetables diet greens
🍎 Red apple | fruit apple snack healthy
🍌 Banana | fruit
🍓 Strawberry | berries fruit
🍇 Grapes | fruit
🍉 Watermelon | fruit
🍊 Tangerine | orange citrus fruit
🍋 Lemon | citrus lime
🍍 Pineapple | fruit
🥭 Mango | fruit
🥥 Coconut | buko fruit
🥑 Avocado | fruit healthy fats
🥦 Broccoli | vegetables veggies greens
🥬 Leafy green | lettuce kangkong pechay vegetables greens
🥕 Carrot | vegetables veggies
🌽 Corn | vegetables
🍅 Tomato | vegetables
🥒 Cucumber | vegetables
🌶️ Hot pepper | spicy chili chilli
🧄 Garlic | cooking
🧅 Onion | cooking
🍠 Sweet potato | kamote root
🫘 Beans | legumes fiber fibre
🥜 Peanuts | nuts snack
🍳 Cooking | egg eggs breakfast fry cook cooking pan
🥚 Egg | protein eggs
🍞 Bread | toast bakery carbs
🥐 Croissant | pastry bakery
🥞 Pancakes | breakfast brunch
🍚 Cooked rice | rice kanin carbs
🍜 Noodle bowl | noodles ramen soup
🍲 Pot of food | stew soup sinigang
🍛 Curry rice | curry
🍝 Spaghetti | pasta
🍕 Pizza | takeout
🍔 Hamburger | burger fast food takeout
🍟 French fries | fries fast food junk food
🌮 Taco | mexican
🌯 Burrito | wrap
🥪 Sandwich | lunch
🍣 Sushi | japanese fish
🍱 Bento box | lunch packed meal prep baon
🥩 Cut of meat | steak protein beef meat
🍖 Meat on bone | meat pork
🍤 Fried shrimp | seafood prawn
🥛 Glass of milk | milk dairy calcium
🧀 Cheese | dairy
🍦 Soft ice cream | dessert ice cream
🍰 Shortcake | cake dessert sweets
🧁 Cupcake | dessert sweets baking
🍩 Doughnut | donut sweets
🍪 Cookie | snack snacks sweets biscuit
🍫 Chocolate bar | chocolate sweets candy
🍬 Candy | sweets sugar
🍿 Popcorn | snack movie
🧂 Salt | sodium seasoning
🥄 Spoon | eat
☕ Hot drink | coffee cafe tea latte espresso caffeine cup mug
🍵 Tea | teacup matcha green tea
🫖 Teapot | tea
🧋 Bubble tea | milk tea boba
🥤 Cup with straw | soda soft drink juice softdrinks
🧃 Juice box | juice
🍺 Beer mug | beer alcohol drinks drinking
🍷 Wine glass | wine alcohol drinks
🍸 Cocktail | drinks bar alcohol
🥃 Tumbler glass | whiskey liquor alcohol`,
  ],
  [
    "sleep",
    "Sleep",
    `🛏️ Bed | sleep bedtime rest nap
🌙 Crescent moon | night sleep bedtime evening
😴 Sleeping face | sleep tired nap zzz
💤 Zzz | sleep snooze
🛌 Person in bed | sleep rest lie in
⏰ Alarm clock | wake up alarm morning early
🌅 Sunrise | morning routine wake up dawn early
🌇 Sunset | evening dusk
🌃 Night with stars | night evening
🌌 Milky way | stars night sky
🌠 Shooting star | wish night
🥱 Yawning face | tired sleepy
😪 Sleepy face | tired sleep
🧸 Teddy bear | kids bedtime toy
🕯️ Candle | wind down calm evening`,
  ],
  [
    "mind",
    "Mind & focus",
    `🧠 Brain | mind think learn memory focus brain training
🧘 Person in lotus position | meditate meditation yoga mindfulness calm breathe breathing
🪷 Lotus | calm meditation zen
🌬️ Wind face | breathe breathing breathwork
🎯 Direct hit | goal goals target focus aim
⏳ Hourglass | time focus pomodoro deadline wait
⌛ Hourglass done | time up
📵 No phones | no phone screen time digital detox offline social media
🔕 Bell with slash | do not disturb focus quiet notifications silent
🔇 Muted speaker | quiet silence mute
🚫 Prohibited | no stop quit avoid bad habit break
⛔ No entry | stop limit
🧩 Puzzle piece | puzzle brain game problem
♟️ Chess pawn | chess strategy
💭 Thought balloon | think reflect thoughts
🤔 Thinking face | think reflect decide
😌 Relieved face | calm relaxed relax
😊 Smiling face | happy mood gratitude
😀 Grinning face | happy smile mood
😢 Crying face | sad cry mood
😡 Angry face | angry anger mood
😰 Anxious face | anxiety stress worry mood
🥰 Smiling face with hearts | love grateful
😎 Smiling face with sunglasses | cool confident
😤 Face with steam | determined frustrated
🫶 Heart hands | gratitude love kindness thanks
✨ Sparkles | new magic shine glow
🔋 Battery | energy recharge rest
🪫 Low battery | tired burnout drained
🌀 Cyclone | overwhelm chaos stress`,
  ],
  [
    "learning",
    "Learning",
    `📖 Open book | read reading book pages study bible
📚 Books | study library reading books learn school
📕 Closed book | book novel
📓 Notebook | notes notebook
📔 Decorated notebook | diary journal
✍️ Writing hand | write writing journal journaling handwriting
📝 Memo | note notes write homework
✏️ Pencil | write draw sketch homework
🖊️ Pen | write sign
🖋️ Fountain pen | calligraphy writing
🖍️ Crayon | draw kids colour color
🗒️ Spiral notepad | notes list
🎓 Graduation cap | school graduate degree university college class course
🏫 School | class
🎒 Backpack | school bag
🧑‍🏫 Teacher | teach tutor class lesson
🧑‍🎓 Student | study student
🔬 Microscope | science biology lab research
🔭 Telescope | astronomy space science
🧮 Abacus | math maths count
📐 Triangle ruler | geometry design math
📏 Ruler | measure
🌍 Globe | world geography language languages
🗣️ Speaking head | speak speaking language talk speech practice pronunciation
🔤 Letters | language alphabet abc spelling vocabulary words
📰 Newspaper | news read
🔖 Bookmark | save read later
📜 Scroll | history certificate
🔎 Magnifying glass | search research explore investigate`,
  ],
  [
    "work",
    "Work",
    `💼 Briefcase | work job office salary career business
🏢 Office building | office work company
🧑‍💼 Office worker | job work professional
👔 Necktie | work formal interview
📊 Bar chart | report stats data analytics
📅 Calendar | schedule date plan event
🗓️ Spiral calendar | planner schedule week plan
📋 Clipboard | tasks checklist todo list plan
☑️ Check box | done tick task todo
📌 Pushpin | pin important
📎 Paperclip | attach
🗂️ Card dividers | organise organize files folders
📁 File folder | files docs documents
🗃️ Card file box | archive
✉️ Envelope | email mail letter inbox
📧 E-mail | email inbox
📞 Telephone receiver | call phone meeting
🤝 Handshake | meeting deal partner client network networking
💬 Speech balloon | chat message messages talk reply
⚙️ Gear | settings process system
🏗️ Construction | build project construction
🚀 Rocket | launch ship startup fast
⏲️ Timer clock | timer`,
  ],
  [
    "money",
    "Money & shopping",
    `💰 Money bag | money savings income cash other income
💵 Banknote | cash money bills
💳 Credit card | card debit pay payment
🪙 Coin | coins change savings
🏦 Bank | bank fees savings account loan
🐷 Pig face | piggy bank savings save
🧾 Receipt | bills bill invoice receipt expense
📈 Chart up | growth interest invest investing stocks trend up
📉 Chart down | loss down drop
💹 Market chart | stocks market trading
💸 Money with wings | spend spending expense
🤑 Money face | rich
💲 Dollar sign | price cost
💱 Currency exchange | forex exchange
🏧 ATM | atm cash withdraw
👛 Purse | wallet
👜 Handbag | bag
🛒 Shopping cart | groceries grocery supermarket shopping
🛍️ Shopping bags | shopping mall clothes
🏷️ Label | tag price sale category label
🎁 Wrapped gift | gift gifts present birthday christmas
🧧 Red envelope | ang pao gift money
🏪 Convenience store | store sari-sari 7-eleven
🏬 Department store | mall
📦 Package | delivery parcel order online shopping lazada shopee
💎 Gem stone | jewelry jewellery luxury
⚖️ Balance scale | balance adjust adjustment scale weigh law
🎰 Slot machine | gambling casino lotto`,
  ],
  [
    "home",
    "Home & chores",
    `🏠 House | home rent house
🏡 House with garden | home garden yard
🛋️ Couch and lamp | living room furniture relax
🪑 Chair | furniture
🚪 Door | door lock up
🔑 Key | key keys lock
🧹 Broom | clean cleaning sweep chores tidy
🧺 Basket | laundry basket
🧽 Sponge | dishes wash clean
🪣 Bucket | mop clean
🧼 Soap | wash hands hygiene clean
🧻 Toilet paper | supplies
🚽 Toilet | bathroom
🚿 Shower | shower wash
🛁 Bathtub | bath
🗑️ Wastebasket | trash garbage bins rubbish take out
♻️ Recycling | recycle sustainability
🧰 Toolbox | tools repair diy
🛠️ Hammer and wrench | fix repair maintenance tools
🔨 Hammer | build diy
🪛 Screwdriver | fix
🔧 Wrench | plumbing fix
💡 Light bulb | electricity power light bill idea
🔌 Electric plug | power charge electricity
🚰 Tap water | water bill tap
🧊 Ice | freezer fridge ice
🧯 Fire extinguisher | safety
🪟 Window | windows
🪞 Mirror | mirror
🪜 Ladder | ladder
🧷 Safety pin | mend
🧦 Socks | laundry clothes
👕 T-shirt | clothes laundry ironing outfit`,
  ],
  [
    "people",
    "Family & social",
    `👶 Baby | baby kids childcare diapers
🧒 Child | kid kids son daughter
👧 Girl | daughter kid
👪 Family | family parents home
👨‍👩‍👧 Family of three | family parents
👫 Couple holding hands | couple date partner
💑 Couple with heart | partner date love relationship anniversary
👵 Grandmother | grandma lola grandparents
👴 Grandfather | grandpa lolo grandparents
🤱 Breastfeeding | nursing feed baby
🍼 Baby bottle | feed baby formula
🧑‍🤝‍🧑 People holding hands | friends together
🫂 People hugging | hug support comfort
🤗 Hugging face | hug
👋 Waving hand | hello call reach out say hi
☎️ Telephone | call parents phone call
❤️ Red heart | love heart partner care
💌 Love letter | letter love note
💍 Ring | wedding engagement marriage
💒 Wedding | church wedding
💐 Bouquet | flowers gift date
🎂 Birthday cake | birthday cake celebrate
🎉 Party popper | party celebrate celebration congrats
🥳 Partying face | party celebrate
🎊 Confetti ball | celebrate
🎈 Balloon | party
🥂 Clinking glasses | cheers toast celebrate drinks
🍻 Beer mugs | drinks friends night out
🙌 Raising hands | celebrate hooray
👏 Clapping hands | applause congrats
👯 Dancing friends | friends dance party`,
  ],
  [
    "travel",
    "Travel & transport",
    `✈️ Airplane | flight travel trip vacation fly
🛫 Departure | departure flight airport
🛬 Arrival | arrival flight airport
🧳 Luggage | travel trip packing suitcase
🛂 Passport control | passport visa immigration
🎫 Ticket | ticket pass fare boarding
🗺️ World map | map travel explore trip
🌏 Globe Asia | world travel philippines asia
🧭 Compass | navigate direction explore
🏨 Hotel | hotel stay booking
🏖️ Beach with umbrella | beach vacation holiday
🏝️ Desert island | island vacation
⛺ Tent | camping camp outdoors
🏕️ Camping | camp outdoors
🗼 Tower | landmark sightseeing
🏰 Castle | sightseeing
⛩️ Shrine | japan temple
🚗 Car | car grab drive driving ride
🚕 Taxi | cab grab ride
🚌 Bus | bus transport commute
🚏 Bus stop | jeepney stop
🚐 Minibus | van jeepney uv express
🚇 Metro | train mrt lrt subway commute
🚆 Train | train rail
🚲 Bicycle | bike cycle commute
🛵 Motor scooter | scooter motorbike moto angkas
🏍️ Motorcycle | motorbike
🛺 Auto rickshaw | tricycle tuk tuk
⛽ Fuel pump | gas petrol fuel diesel
🅿️ Parking | parking
🚦 Traffic light | traffic
🛣️ Motorway | road trip highway
⛴️ Ferry | boat ferry
🚢 Ship | cruise
⛵ Sailboat | sailing boat
🚁 Helicopter | fly`,
  ],
  [
    "hobbies",
    "Hobbies & creativity",
    `🎸 Guitar | guitar music practice instrument play
🎹 Piano | piano keyboard music
🥁 Drum | drums music
🎻 Violin | music
🎺 Trumpet | music
🎷 Saxophone | music
🎤 Microphone | sing singing karaoke vocals
🎙️ Studio microphone | podcast record
🎧 Headphones | music podcast listen audiobook
🎵 Musical note | music song
🎶 Musical notes | music songs
🎨 Artist palette | art paint painting draw drawing creative
🖌️ Paintbrush | paint
🖼️ Framed picture | art gallery
✂️ Scissors | crafts cut
🧶 Yarn | knit knitting crochet
🧵 Thread | sew sewing embroidery
🪡 Sewing needle | sew mend
🧱 Brick | lego build
📷 Camera | photo photography pictures
📸 Camera with flash | photo selfie
🎥 Movie camera | film video record vlog
🎬 Clapper board | movies film subscriptions netflix streaming
📺 Television | tv shows series
🎮 Video game | games gaming play console
🕹️ Joystick | arcade games retro
🎲 Game die | board games dice
🃏 Joker | cards
🎟️ Admission tickets | entertainment concert event tickets show
🎭 Performing arts | theatre theater drama acting
🎪 Circus tent | fair event
💃 Woman dancing | dance dancing zumba
🕺 Man dancing | dance dancing
🪀 Yo-yo | toys
🪁 Kite | kite
🪄 Magic wand | magic
🎣 Fishing pole | fishing
🧑‍🍳 Cook | cooking chef cook meal prep baking bake recipe`,
  ],
  [
    "nature",
    "Nature & pets",
    `🐶 Dog face | dog pet pets walk the dog puppy
🐕 Dog | dog walk
🐱 Cat face | cat pet kitten
🐈 Cat | cat pet
🐾 Paw prints | pets pet animal vet
🐟 Fish | fish aquarium
🐠 Tropical fish | fish aquarium
🐢 Turtle | slow
🐇 Rabbit | bunny pet
🐹 Hamster | pet
🐦 Bird | bird birdwatching
🦜 Parrot | bird pet
🐔 Chicken | poultry farm
🐴 Horse | horse riding
🐄 Cow | farm dairy
🐝 Honeybee | bee busy
🦋 Butterfly | change growth
🐞 Ladybug | ladybird insect
🌱 Seedling | grow growth plant garden start sprout
🪴 Potted plant | plants water the plants houseplant garden
🌿 Herb | herbs plants
🍀 Four leaf clover | luck lucky
🌳 Tree | tree park nature outdoors
🌲 Evergreen tree | forest hike
🌴 Palm tree | tropical beach
🌵 Cactus | desert
🌸 Cherry blossom | flower flowers spring
🌻 Sunflower | flower
🌹 Rose | flower
🌷 Tulip | flower
🍁 Maple leaf | autumn fall
🍂 Fallen leaf | autumn fall
☀️ Sun | sun morning sunny sunlight daylight outside outdoors
🌤️ Sun and cloud | weather
🌧️ Rain cloud | rain weather
❄️ Snowflake | winter cold
🌈 Rainbow | hope pride
⛰️ Mountain | hike hiking climb outdoors
🏔️ Snowy mountain | mountain trek
🌄 Sunrise over mountains | sunrise hike
🏞️ National park | park nature outdoors
🌊 Wave | ocean sea beach surf
🌋 Volcano | mountain
🌕 Full moon | moon`,
  ],
  [
    "faith",
    "Faith & self-care",
    `🙏 Folded hands | pray prayer gratitude thanks please faith
🤲 Palms up | pray dua
📿 Prayer beads | rosary prayer
✝️ Cross | church christian faith
⛪ Church | mass service worship sunday
🕌 Mosque | prayer salah islam
🕍 Synagogue | jewish
☪️ Star and crescent | islam
🕉️ Om | hindu yoga
☸️ Wheel of dharma | buddhism buddhist
🛐 Place of worship | worship
😇 Smiling face with halo | blessed angel
🕊️ Dove | peace
☯️ Yin yang | balance
🛀 Person taking a bath | bath soak relax self care
🧖 Person in sauna | sauna spa steam
💆 Massage | massage spa relax
💇 Haircut | haircut salon hair
💈 Barber pole | barber haircut personal care grooming
💅 Nail polish | nails manicure
💄 Lipstick | makeup beauty
🧴 Lotion bottle | skincare skin care sunscreen moisturiser moisturizer lotion
🪒 Razor | shave shaving
🫧 Bubbles | bath clean bubbles
💖 Sparkling heart | self love
🎀 Ribbon | bow`,
  ],
  [
    "tech",
    "Tech",
    `💻 Laptop | computer code coding laptop freelance side income work
🖥️ Desktop computer | computer pc
⌨️ Keyboard | typing type
🖱️ Computer mouse | mouse
📱 Mobile phone | phone mobile plan smartphone
📲 Phone with arrow | app download
📶 Signal bars | internet wifi data signal
💾 Floppy disk | save backup
💿 Disc | cd music
🖨️ Printer | print
📡 Satellite dish | signal
🛰️ Satellite | space
🤖 Robot | ai bot automation
🧑‍💻 Technologist | code coding programming developer
🐛 Bug | bug debug fix
🔒 Locked | password security privacy lock
🔐 Locked with key | security
🛡️ Shield | security protect
☁️ Cloud | cloud backup storage
🔗 Link | link url
🌐 Globe with meridians | web internet website browse
📹 Video camera | video call zoom meeting
⌚ Watch | smartwatch watch
🔦 Flashlight | torch
🧲 Magnet | magnet
⚡ Lightning | energy power electricity fast
🔔 Bell | reminder notification alert
📣 Megaphone | announce`,
  ],
  [
    "misc",
    "Misc",
    `✅ Check mark | done check complete yes tick habit
✔️ Tick | done
❌ Cross mark | no stop quit
⭐ Star | favourite favorite star rating
🌟 Glowing star | shine proud
🔥 Fire | streak hot burn
💯 Hundred points | perfect score
🏁 Chequered flag | finish race done
🚩 Flag | flag milestone
🔴 Red circle | red
🟠 Orange circle | orange
🟡 Yellow circle | yellow
🟢 Green circle | green
🔵 Blue circle | blue
🟣 Purple circle | purple
❓ Question mark | question unknown
❗ Exclamation mark | important urgent
⚠️ Warning | warning caution
📍 Location pin | location place
🔁 Repeat | repeat recurring routine
🔄 Refresh | sync refresh
➕ Plus | add more
♾️ Infinity | forever
🎗️ Awareness ribbon | cause awareness
🆕 New | new
🕐 Clock | time hour
🪪 ID card | id license documents
🗝️ Old key | key
🎖️ Military medal | medal honour
👍 Thumbs up | good yes like
👎 Thumbs down | bad no dislike
🤞 Crossed fingers | luck hope
✌️ Victory hand | peace`,
  ],
]

export const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)

export const ICON_SECTIONS: IconSection[] = RAW.map(([id, title, lines]) => ({
  id,
  title,
  icons: lines.split("\n").map((line) => {
    const space = line.indexOf(" "),
      bar = line.indexOf("|"),
      name = line.slice(space + 1, bar).trim()
    return {
      emoji: line.slice(0, space),
      name,
      words: [...new Set(words(`${name} ${line.slice(bar + 1)}`))],
      section: id,
    }
  }),
}))
export const ALL_ICONS = ICON_SECTIONS.flatMap((s) => s.icons)

/** The variation selector (U+FE0F) is optional in stored text: "🏋" and
 * "🏋️" are the same icon. */
export const iconKey = (emoji: string) => emoji.replace(/️/g, "")
const byKey = new Map(ALL_ICONS.map((i) => [iconKey(i.emoji), i]))
export const findIcon = (emoji: string) => byKey.get(iconKey(emoji))
/** What VoiceOver says for an icon; a saved icon that predates the
 * catalogue reads as itself. */
export const iconLabel = (emoji: string) => findIcon(emoji)?.name ?? emoji
