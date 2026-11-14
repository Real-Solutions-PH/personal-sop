"""The test sentences: what a person of Unfurl's kind says to Fern.

Each row is (id, category, text as meant, key terms that must survive). The
"real" rows are real chat messages the phone's recogniser got wrong; the rest
cover money, fitness, food (Filipino and brands), habits and Taglish. First
used for ADR-0016 (2026-10-23); unchanged since, so results compare.
"""

# (id, category, text, key terms that must survive transcription)
CORPUS = [
    # --- real chat messages, as meant (the phone's recogniser got them wrong)
    (
        "r01",
        "real",
        "Fern, I want to record a scheduled income for December 25, which will be 600,000 pesos from Real Solutions PH.",
        ["fern", "december 25", "600000", "real solutions"],
    ),
    (
        "r02",
        "real",
        "Then record some recurring costs that I have right now. First, 30,000 for my parents, another 36,000 for the monthly payment for the 300 square meter land.",
        ["recurring", "30000", "36000", "300"],
    ),
    (
        "r03",
        "real",
        "Can I also take my protein shake instead? My shake will be the whey protein or ON protein powder, milk, 2 tablespoons of basil seeds and 1 tablespoon of flax.",
        ["whey protein", "basil seeds", "flax", "2 tablespoons"],
    ),
    (
        "r04",
        "real",
        "The energy drink I had is Monster Zero Sugar, the white one, then the Quaker oats cookies, honey flavor.",
        ["monster", "zero sugar", "quaker", "honey"],
    ),
    (
        "r05",
        "real",
        "Record my lunch: 150 grams of rice, 120 grams of vegetables from pinakbet, less bagoong, and 100 grams of boiled chicken breast.",
        ["150", "120", "pinakbet", "bagoong", "chicken breast"],
    ),
    (
        "r06",
        "real",
        "I also want to record some new habits: taking isotretinoin, and taking two fish oil capsules.",
        ["isotretinoin", "fish oil"],
    ),
    (
        "r07",
        "real",
        "Add another budget specifically for food, which is 10K every month, then allocate 5,000 every month for gym supplies.",
        ["budget", "10k", "5000", "gym supplies"],
    ),
    (
        "r08",
        "real",
        "Move all of the scheduled income and expenses from Maya Black to Maya Savings. Note that Maya Black is a credit card.",
        ["maya black", "maya savings", "credit card"],
    ),
    (
        "r09",
        "real",
        "Can I still take a protein shake with 2 tablespoons of basil seeds, 1 tablespoon of ground flax seeds, 250 ml of nonfat milk and 4 tablespoons of oats, since I'm low on fiber?",
        ["basil seeds", "flax", "250", "nonfat milk", "fiber"],
    ),
    (
        "r10",
        "real",
        "Add fixing the bed as a habit and make it the first one in the morning routine.",
        ["fixing the bed", "habit", "morning routine"],
    ),
    # --- English, numbers and money
    (
        "e01",
        "money",
        "I spent 250 pesos on Grab this morning and 1,800 on the PLDT bill.",
        ["250", "grab", "1800", "pldt"],
    ),
    (
        "e02",
        "money",
        "Log an expense of 14,617.24 pesos, a reimbursement from Real Solutions PH.",
        ["14617.24", "real solutions"],
    ),
    (
        "e03",
        "money",
        "Transfer 3,500 from GoTyme to MariBank on the 30th.",
        ["3500", "gotyme", "maribank", "30th"],
    ),
    (
        "e04",
        "money",
        "My salary is 1,600 dollars on the 9th and 1,500 dollars on the 22nd of every month.",
        ["1600", "9th", "1500", "22nd"],
    ),
    (
        "e05",
        "fitness",
        "I ran 5K in 32 minutes, then did three sets of Romanian deadlifts at 60 kilos.",
        ["5k", "32 minutes", "romanian deadlift", "60"],
    ),
    (
        "e06",
        "fitness",
        "Bench press 70 kilos for 8 reps, then lat pulldown and face pulls.",
        ["bench press", "70", "8 reps", "lat pulldown", "face pull"],
    ),
    (
        "e07",
        "food",
        "Breakfast was two hard-boiled eggs, one slice of Gardenia wheat bread and a Nescafe canned coffee.",
        ["two", "gardenia", "nescafe"],
    ),
    (
        "e08",
        "food",
        "For dinner I had a Betagro garlic butter chicken breast with one cup of rice and a Chobani Greek yogurt.",
        ["betagro", "garlic butter", "chobani", "greek yogurt"],
    ),
    (
        "e09",
        "food",
        "I drank a Red Bull Sugarfree and ate a Reese's Sticks bar at 3 PM.",
        ["red bull", "sugarfree", "reese's", "3 pm"],
    ),
    (
        "e10",
        "food",
        "Log one serving of Athlene whey protein, chocolate fudge flavor, with 200 ml of low fat milk.",
        ["athlene", "whey protein", "200", "low fat milk"],
    ),
    (
        "e11",
        "habit",
        "Remind me to take my isotretinoin at 9 PM and to do my face skin care routine before bed.",
        ["isotretinoin", "9 pm", "skin care"],
    ),
    (
        "e12",
        "fern",
        "Hey Fern, what's left of my protein for today?",
        ["fern", "protein"],
    ),
    (
        "e13",
        "fern",
        "Fern, how many calories do I have left, and how's my fiber?",
        ["fern", "calories", "fiber"],
    ),
    # --- Filipino foods
    (
        "f01",
        "food",
        "I had tapsilog for breakfast and pancit canton for merienda.",
        ["tapsilog", "pancit canton", "merienda"],
    ),
    (
        "f02",
        "food",
        "Lunch was chicken adobo with one cup of rice and a bowl of sinigang na baboy.",
        ["adobo", "sinigang"],
    ),
    (
        "f03",
        "food",
        "I ate two pieces of pork longganisa, galunggong and pancit palabok.",
        ["longganisa", "galunggong", "palabok"],
    ),
    (
        "f04",
        "food",
        "Snack was turon and a halo-halo from Chowking.",
        ["turon", "halo-halo", "chowking"],
    ),
    # --- Taglish
    (
        "t01",
        "taglish",
        "Fern, nag-gym ako kanina, mga one hour, tapos nag-run ako ng 3K.",
        ["fern", "gym", "one hour", "3k"],
    ),
    (
        "t02",
        "taglish",
        "Kumain ako ng adobo at dalawang cup ng rice for lunch.",
        ["kumain", "adobo", "rice"],
    ),
    (
        "t03",
        "taglish",
        "Nagbayad ako ng 500 pesos sa Meralco kahapon.",
        ["nagbayad", "500", "meralco", "kahapon"],
    ),
    (
        "t04",
        "taglish",
        "Pakidagdag mo yung tapsilog sa breakfast ko, tsaka isang Monster Zero.",
        ["tapsilog", "breakfast", "monster"],
    ),
    (
        "t05",
        "taglish",
        "Hindi ko pa nagawa yung morning journal, paki-remind mo ako mamayang gabi.",
        ["morning journal", "mamaya"],
    ),
    (
        "t06",
        "taglish",
        "Gumastos ako ng 1,200 sa grocery sa SM, tapos 300 sa Jollibee.",
        ["1200", "grocery", "300", "jollibee"],
    ),
    (
        "t07",
        "taglish",
        "Ilang calories pa ang natitira sa akin today, Fern?",
        ["calories", "fern"],
    ),
    (
        "t08",
        "taglish",
        "Nag-pasalubong ako ng 2,000 pesos para sa family ko.",
        ["pasalubong", "2000", "family"],
    ),
]
