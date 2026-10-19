// Nomes dos emojis do seletor em inglês e espanhol (o português fica no emoji.ts). Uma
// linha por emoji: o emoji e as palavras pra busca, em minúsculas e sem acento; a primeira
// é o nome que aparece (`:nome:` nas sugestões e no leitor de tela). No inglês, a primeira
// é o código de sempre (o do Discord e do GitHub).

export const EMOJI_NAMES = {
  en: `
😀 grinning smile happy
😃 smiley happy smile eyes
😄 smile happy joy
😁 grin teeth beaming
😆 laughing laugh satisfied
😅 sweat_smile sweat nervous laugh
🤣 rofl rolling laughing
😂 joy tears laughing lol
🙂 slightly_smiling smile
🙃 upside_down irony sarcasm
😉 wink
😊 blush happy
😇 innocent angel halo
🥰 smiling_hearts in love adore
😍 heart_eyes love
🤩 star_struck starry eyes amazed
😘 kissing_heart kiss
😗 kissing kiss
😚 kissing_closed_eyes kiss
😋 yum delicious tasty
😛 tongue stuck out
😜 stuck_out_tongue_winking_eye tongue wink
🤪 zany crazy goofy
😝 stuck_out_tongue_closed_eyes tongue
🤑 money_mouth money rich
🤗 hugging hug
🤭 hand_over_mouth oops giggle
🤫 shushing quiet secret
🤔 thinking hmm
🫡 saluting salute
🤐 zipper_mouth zip silent
🤨 raised_eyebrow suspicious skeptical
😐 neutral
😑 expressionless blank
😶 no_mouth speechless
🫥 dotted_line invisible
😏 smirk smug
😒 unamused bored
🙄 eye_roll rolling eyes
😬 grimacing awkward
😮‍💨 exhaling sigh relief
🤥 lying liar pinocchio
😌 relieved
😔 pensive sad
😪 sleepy
🤤 drooling
😴 sleeping zzz
😷 mask sick
🤒 thermometer fever sick
🤕 bandage hurt injured
🤢 nauseated sick gross
🤮 vomiting puke
🥵 hot heat sweating
🥶 cold freezing
🥴 woozy drunk dizzy
😵 dizzy_face dizzy
😵‍💫 spiral_eyes confused dizzy
🤯 exploding_head mind blown
🤠 cowboy
🥳 partying party celebrate
🥸 disguised disguise
😎 sunglasses cool
🤓 nerd geek
🧐 monocle inspecting
😕 confused
🫤 diagonal_mouth unsure meh
😟 worried
🙁 slightly_frowning sad
😮 open_mouth surprised wow
😯 hushed surprised
😲 astonished shocked
😳 flushed embarrassed
🥺 pleading puppy eyes
🥹 holding_back_tears touched moved
😦 frowning scared
😧 anguished
😨 fearful scared
😰 anxious sweat
😥 sad_relieved disappointed
😢 cry tear sad
😭 sob crying loudly
😱 scream fear
😖 confounded frustrated
😣 persevere
😞 disappointed
😓 downcast_sweat cold sweat
😩 weary tired
😫 tired_face exhausted
🥱 yawning yawn
😤 triumph huff steam
😡 rage furious
😠 angry mad
🤬 cursing swearing
😈 smiling_imp devil
👿 imp angry devil
💀 skull dead
☠️ skull_crossbones bones
💩 poop
🤡 clown
👹 ogre
👻 ghost
👽 alien
🤖 robot
😺 smiley_cat cat smile
😹 joy_cat cat laughing
😻 heart_eyes_cat cat love
🙈 see_no_evil monkey
🙉 hear_no_evil monkey
🙊 speak_no_evil monkey
👋 wave hello bye hi
🤚 raised_back_of_hand hand
✋ raised_hand stop high five
🖖 vulcan spock
👌 ok_hand perfect
🤌 pinched_fingers italian
🤏 pinching tiny little
✌️ victory peace
🤞 crossed_fingers luck
🫰 finger_heart heart fingers
🤟 love_you_gesture love you
🤘 metal rock horns
🤙 call_me shaka
👈 point_left left
👉 point_right right
👆 point_up up
👇 point_down down
☝️ point_up_2 index one
👍 thumbsup like yes
👎 thumbsdown dislike no
✊ fist raised
👊 punch fist bump
🤛 left_facing_fist fist bump
🤜 right_facing_fist fist bump
👏 clap applause
🙌 raised_hands celebrate hooray
🫶 heart_hands love
👐 open_hands
🤲 palms_up_together
🤝 handshake deal agreement
🙏 pray please thanks
✍️ writing_hand write
💅 nail_care nails polish
💪 muscle strong flex
🧠 brain
👀 eyes looking
👁️ eye
👄 lips mouth
🫦 biting_lip
👶 baby
🧒 child kid
👦 boy
👧 girl
🧑 person adult
👨 man
👩 woman
🧓 older_person elder
👴 older_man grandpa
👵 older_woman grandma
🙋 raising_hand hand up
🙅 no_good no gesture
🙆 ok_person ok gesture
🤷 shrug idk
🤦 facepalm
🙇 bow sorry
💁 tipping_hand info
🧏 deaf_person deaf
🚶 walking walk
🏃 running run
💃 dancer dancing
🕺 man_dancing dancing
👯 dancers party
🧘 lotus_position meditation yoga
🛌 sleeping_bed bed sleep
👨‍💻 man_technologist programmer computer
👩‍💻 woman_technologist programmer computer
🧑‍🎤 singer rockstar
🥷 ninja
🦸 superhero hero
🦹 supervillain villain
🧙 mage wizard
🧛 vampire
🧟 zombie
🐶 dog puppy
🐱 cat kitten
🐭 mouse
🐹 hamster
🐰 rabbit bunny
🦊 fox
🐻 bear
🐼 panda
🐨 koala
🐯 tiger
🦁 lion
🐮 cow
🐷 pig
🐸 frog
🐵 monkey
🐔 chicken hen
🐧 penguin
🐦 bird
🐤 baby_chick chick
🦆 duck
🦅 eagle
🦉 owl
🦇 bat
🐺 wolf
🐗 boar
🐴 horse
🦄 unicorn
🐝 bee honeybee
🐛 bug caterpillar
🦋 butterfly
🐌 snail
🐞 ladybug ladybird
🐜 ant
🕷️ spider
🐢 turtle
🐍 snake
🦎 lizard
🦖 dinosaur trex
🐙 octopus
🦑 squid
🦀 crab
🐠 fish tropical
🐬 dolphin
🐳 whale
🦈 shark
🐊 crocodile alligator
🐘 elephant
🦒 giraffe
🐕 dog
🐈 cat
🐓 rooster
🦜 parrot
🌵 cactus
🎄 christmas_tree xmas
🌲 evergreen_tree pine
🌳 tree
🌴 palm_tree coconut
🌱 seedling sprout plant
🍀 four_leaf_clover clover luck
🍁 maple_leaf leaf fall autumn
🍄 mushroom
🌷 tulip flower
🌹 rose flower
🌻 sunflower
🌸 cherry_blossom flower
💐 bouquet flowers
🌎 earth world globe
🌙 moon crescent
⭐ star
🌟 star2 glowing star
✨ sparkles shine
⚡ zap lightning
🔥 fire lit
🌈 rainbow
☀️ sunny sun
⛅ partly_sunny cloud
🌧️ rain
⛈️ thunderstorm storm
❄️ snowflake snow
☃️ snowman
🌊 ocean wave sea
💧 droplet drop
🍎 apple
🍊 orange tangerine
🍋 lemon
🍌 banana
🍉 watermelon
🍇 grapes
🍓 strawberry
🍒 cherries
🍑 peach
🥭 mango
🍍 pineapple
🥥 coconut
🥝 kiwi
🍅 tomato
🥑 avocado
🌶️ hot_pepper chili
🌽 corn
🥕 carrot
🥔 potato
🍞 bread
🧀 cheese
🥚 egg
🍳 cooking fried egg
🥓 bacon
🥩 meat steak
🍗 poultry_leg chicken
🌭 hotdog
🍔 hamburger burger
🍟 fries
🍕 pizza
🥪 sandwich
🌮 taco
🌯 burrito
🥗 salad
🍝 spaghetti pasta
🍜 ramen noodles
🍣 sushi
🍤 fried_shrimp shrimp
🍙 rice_ball onigiri
🍚 rice
🍰 cake slice
🎂 birthday cake
🧁 cupcake
🍩 doughnut donut
🍪 cookie
🍫 chocolate
🍬 candy sweet
🍭 lollipop
🍿 popcorn
🍦 icecream ice cream cone
☕ coffee
🍵 tea
🧉 mate
🥤 cup_with_straw soda
🧃 juice_box juice
🍺 beer
🍻 beers cheers
🥂 champagne_glasses toast cheers
🍷 wine
🥃 whisky tumbler
🍸 cocktail drink
🍹 tropical_drink
🧊 ice
⚽ soccer football ball
🏀 basketball
🏈 american_football
⚾ baseball
🎾 tennis
🏐 volleyball
🏉 rugby
🎱 8ball pool billiards
🏓 ping_pong table tennis
🏸 badminton
🥊 boxing_glove boxing
🥋 martial_arts karate
⛳ golf
🏆 trophy champion
🥇 first_place gold medal
🥈 second_place silver
🥉 third_place bronze
🏅 medal
🎯 dart bullseye target
🎮 video_game controller gaming
🕹️ joystick arcade
🎲 game_die dice
♟️ chess pawn
🧩 puzzle jigsaw
🎨 art palette painting
🎬 clapper movie film
🎤 microphone karaoke
🎧 headphones music
🎸 guitar
🎹 piano keyboard
🥁 drum
🎷 saxophone
🎺 trumpet
🎻 violin
🎉 tada party confetti
🎊 confetti_ball confetti
🎈 balloon
🎁 gift present
🎃 jack_o_lantern pumpkin halloween
🎆 fireworks
🎇 sparkler
🧨 firecracker
💻 laptop computer
🖥️ desktop computer monitor
⌨️ keyboard
🖱️ computer_mouse mouse
📱 phone mobile
☎️ telephone
📞 telephone_receiver call
📷 camera photo
🎥 movie_camera video
📺 tv television
🔊 loud_sound speaker volume
🔇 mute
🎙️ studio_microphone mic
💡 bulb idea
🔦 flashlight
🕯️ candle
💰 moneybag money bag
💸 money_with_wings spending
💳 credit_card card
💎 gem diamond
🔧 wrench tool
🔨 hammer
⚙️ gear settings
🔗 link chain
🔒 lock locked
🔓 unlock open
🔑 key
🛡️ shield
⚔️ crossed_swords swords
🗡️ dagger
💣 bomb
🧲 magnet
📦 package box
📫 mailbox mail
✉️ envelope email
📝 memo note
📌 pushpin pin
📎 paperclip attachment
✂️ scissors
📅 calendar date
⏰ alarm_clock alarm
⏳ hourglass waiting
⌛ hourglass_done time up
🚀 rocket launch
✈️ airplane plane
🚗 car
🏠 house home
🏖️ beach
🗿 moai serious
❤️ heart red love
🧡 orange_heart
💛 yellow_heart
💚 green_heart
💙 blue_heart
💜 purple_heart
🖤 black_heart
🤍 white_heart
🤎 brown_heart
💔 broken_heart
❤️‍🔥 heart_on_fire
💕 two_hearts
💞 revolving_hearts
💓 heartbeat
💗 heartpulse growing heart
💖 sparkling_heart
💘 cupid arrow heart
💝 gift_heart
💯 100 hundred perfect
💢 anger
💥 boom collision explosion
💫 dizzy star
💦 sweat_drops splash
💨 dash wind
💬 speech_balloon chat
💭 thought_balloon thought
🗯️ right_anger_bubble
💤 zzz sleep
✅ white_check_mark check done yes
☑️ ballot_box_with_check checkbox
✔️ heavy_check_mark check
❌ x cross wrong no
❎ negative_squared_cross_mark cross
⭕ o circle
🚫 no_entry_sign forbidden
⛔ no_entry
⚠️ warning
❓ question
❔ grey_question question
❗ exclamation
‼️ bangbang double exclamation
⁉️ interrobang
➕ plus
➖ minus
➗ divide division
✖️ multiply times
♾️ infinity
🔴 red_circle
🟠 orange_circle
🟡 yellow_circle
🟢 green_circle
🔵 blue_circle
🟣 purple_circle
⚫ black_circle
⚪ white_circle
🆗 ok
🆕 new
🆒 cool
🆙 up
🔝 top
🔜 soon
1️⃣ one
2️⃣ two
3️⃣ three
4️⃣ four
5️⃣ five
🔟 ten
🇧🇷 brazil
🇵🇹 portugal
🇦🇷 argentina
🇺🇸 united_states usa us america
🇯🇵 japan
🇰🇷 south_korea korea
🇩🇪 germany
🇫🇷 france
🇮🇹 italy
🇪🇸 spain
🇬🇧 united_kingdom uk england britain
🇨🇦 canada
🇲🇽 mexico
🇺🇾 uruguay
🇨🇱 chile
🇨🇴 colombia
🏳️‍🌈 rainbow_flag pride lgbt
🏴‍☠️ pirate_flag pirate
🏁 checkered_flag finish race
🚩 red_flag alert
`,
  es: `
😀 sonrisa feliz
😃 sonrisa feliz ojos
😄 sonrisa alegre
😁 sonrisota dientes
😆 risa carcajada
😅 sudor nervioso risa
🤣 revolcandose de risa
😂 llorando de risa jaja
🙂 sonrisa leve
🙃 al_reves ironia
😉 guino
😊 feliz sonrojado
😇 angel inocente
🥰 enamorado corazones
😍 ojos_de_corazon me encanta
🤩 deslumbrado estrellas
😘 beso
😗 besito
😚 beso ojos cerrados
😋 delicioso rico
😛 lengua
😜 lengua guino
🤪 loco chiflado
😝 lengua ojos cerrados
🤑 dinero
🤗 abrazo
🤭 ups mano en la boca
🤫 silencio secreto
🤔 pensando hmm
🫡 saludo militar
🤐 boca cerrada cremallera
🤨 desconfiado ceja
😐 neutral
😑 sin expresion
😶 sin boca
🫥 invisible
😏 picaro sonrisita
😒 aburrido desden
🙄 ojos en blanco
😬 incomodo mueca
😮‍💨 alivio suspiro
🤥 mentiroso pinocho
😌 aliviado
😔 pensativo triste
😪 sueno
🤤 babeando
😴 durmiendo zzz
😷 mascarilla enfermo
🤒 fiebre enfermo
🤕 herido lastimado
🤢 asco nauseas
🤮 vomitando
🥵 calor caliente
🥶 frio congelado
🥴 mareado borracho
😵 mareado
😵‍💫 confundido girando
🤯 cabeza_explotando mente
🤠 vaquero
🥳 fiesta celebrando
🥸 disfraz
😎 gafas_de_sol genial
🤓 nerd
🧐 monoculo analizando
😕 confundido
🫤 incomodo
😟 preocupado
🙁 triste leve
😮 sorprendido boca abierta
😯 asombrado
😲 impactado
😳 verguenza sonrojado
🥺 suplicando ojitos
🥹 emocionado conteniendo lagrimas
😦 asustado
😧 angustiado
😨 miedo
😰 ansioso sudor
😥 triste aliviado
😢 llorando lagrima
😭 llorando mucho
😱 grito miedo
😖 frustrado confundido
😣 perseverante
😞 decepcionado
😓 sudor frio
😩 cansado
😫 agotado
🥱 bostezo
😤 resoplando orgullo
😡 furioso enojado
😠 enojado rabia
🤬 maldiciendo groseria
😈 diablillo
👿 diablo enojado
💀 calavera muerto
☠️ calavera huesos
💩 caca popo
🤡 payaso
👹 ogro
👻 fantasma
👽 alien extraterrestre
🤖 robot
😺 gato sonriendo
😹 gato riendo
😻 gato enamorado
🙈 mono no veo
🙉 mono no oigo
🙊 mono no hablo
👋 hola adios saludando
🤚 mano levantada
✋ mano alto
🖖 vulcano
👌 ok perfecto
🤌 italiano
🤏 poquito
✌️ paz victoria
🤞 dedos cruzados suerte
🫰 corazon dedos
🤟 te quiero
🤘 rock cuernos
🤙 llamame
👈 izquierda
👉 derecha
👆 arriba
👇 abajo
☝️ indice uno
👍 pulgar_arriba me gusta bien
👎 pulgar_abajo no me gusta
✊ puno
👊 punetazo
🤛 choca izquierda
🤜 choca derecha
👏 aplausos
🙌 celebrando manos
🫶 corazon manos
👐 manos abiertas
🤲 palmas juntas
🤝 apreton de manos acuerdo
🙏 por favor gracias rezar
✍️ escribiendo
💅 unas esmalte
💪 fuerza musculo
🧠 cerebro
👀 ojos mirando
👁️ ojo
👄 boca labios
🫦 mordiendo labio
👶 bebe
🧒 nino
👦 chico
👧 chica
🧑 persona
👨 hombre
👩 mujer
🧓 anciano
👴 abuelo
👵 abuela
🙋 levantando la mano
🙅 no negando
🙆 ok brazos
🤷 ni_idea encogerse de hombros
🤦 facepalm verguenza
🙇 reverencia disculpa
💁 informacion
🧏 sordo
🚶 caminando
🏃 corriendo
💃 bailando
🕺 bailando hombre
👯 fiesta pareja
🧘 meditando yoga
🛌 durmiendo cama
👨‍💻 programador computadora
👩‍💻 programadora computadora
🧑‍🎤 cantante rock
🥷 ninja
🦸 heroe
🦹 villano
🧙 mago
🧛 vampiro
🧟 zombi
🐶 perro perrito
🐱 gato gatito
🐭 raton
🐹 hamster
🐰 conejo
🦊 zorro
🐻 oso
🐼 panda
🐨 koala
🐯 tigre
🦁 leon
🐮 vaca
🐷 cerdo
🐸 rana
🐵 mono
🐔 gallina
🐧 pinguino
🐦 pajaro
🐤 pollito
🦆 pato
🦅 aguila
🦉 buho lechuza
🦇 murcielago
🐺 lobo
🐗 jabali
🐴 caballo
🦄 unicornio
🐝 abeja
🐛 oruga
🦋 mariposa
🐌 caracol
🐞 mariquita
🐜 hormiga
🕷️ arana
🐢 tortuga
🐍 serpiente
🦎 lagartija
🦖 dinosaurio
🐙 pulpo
🦑 calamar
🦀 cangrejo
🐠 pez
🐬 delfin
🐳 ballena
🦈 tiburon
🐊 cocodrilo
🐘 elefante
🦒 jirafa
🐕 perro
🐈 gato
🐓 gallo
🦜 loro
🌵 cactus
🎄 arbol_de_navidad navidad
🌲 pino
🌳 arbol
🌴 palmera
🌱 brote planta
🍀 trebol suerte
🍁 hoja otono
🍄 hongo seta
🌷 tulipan flor
🌹 rosa flor
🌻 girasol
🌸 flor de cerezo
💐 ramo flores
🌎 mundo tierra
🌙 luna
⭐ estrella
🌟 estrella brillante
✨ brillos destellos
⚡ rayo
🔥 fuego
🌈 arcoiris
☀️ sol
⛅ nublado
🌧️ lluvia
⛈️ tormenta
❄️ nieve copo
☃️ muneco de nieve
🌊 ola mar
💧 gota
🍎 manzana
🍊 naranja
🍋 limon
🍌 platano banana
🍉 sandia
🍇 uvas
🍓 fresa frutilla
🍒 cereza
🍑 durazno melocoton
🥭 mango
🍍 pina anana
🥥 coco
🥝 kiwi
🍅 tomate
🥑 aguacate palta
🌶️ chile picante aji
🌽 maiz elote
🥕 zanahoria
🥔 papa patata
🍞 pan
🧀 queso
🥚 huevo
🍳 huevo frito
🥓 tocino bacon
🥩 carne
🍗 pollo muslo
🌭 perrito_caliente hot dog
🍔 hamburguesa
🍟 papas fritas
🍕 pizza
🥪 sandwich
🌮 taco
🌯 burrito
🥗 ensalada
🍝 espagueti pasta
🍜 ramen fideos
🍣 sushi
🍤 camaron gamba
🍙 bola de arroz onigiri
🍚 arroz
🍰 pastel rebanada
🎂 pastel de cumpleanos torta
🧁 cupcake magdalena
🍩 dona rosquilla
🍪 galleta
🍫 chocolate
🍬 caramelo dulce
🍭 paleta piruleta
🍿 palomitas
🍦 helado cucurucho
☕ cafe
🍵 te
🧉 mate
🥤 refresco vaso
🧃 jugo zumo
🍺 cerveza
🍻 brindis cervezas
🥂 brindis copas
🍷 vino
🥃 whisky trago
🍸 coctel trago
🍹 coctel tropical
🧊 hielo
⚽ futbol balon
🏀 baloncesto basquet
🏈 futbol americano
⚾ beisbol
🎾 tenis
🏐 voleibol
🏉 rugby
🎱 billar bola 8
🏓 ping pong
🏸 badminton
🥊 boxeo guante
🥋 artes marciales
⛳ golf
🏆 trofeo campeon
🥇 oro primero
🥈 plata segundo
🥉 bronce tercero
🏅 medalla
🎯 diana blanco
🎮 videojuego control
🕹️ joystick arcade
🎲 dado
♟️ ajedrez
🧩 rompecabezas
🎨 arte pintura
🎬 cine pelicula
🎤 microfono karaoke
🎧 audifonos auriculares musica
🎸 guitarra
🎹 teclado piano
🥁 bateria tambor
🎷 saxofon
🎺 trompeta
🎻 violin
🎉 fiesta confeti
🎊 confeti
🎈 globo
🎁 regalo
🎃 calabaza halloween
🎆 fuegos artificiales
🎇 bengala
🧨 petardo
💻 portatil computadora laptop
🖥️ computadora monitor
⌨️ teclado
🖱️ raton mouse
📱 celular movil
☎️ telefono
📞 telefono llamada
📷 camara foto
🎥 camara video filmando
📺 tele television
🔊 sonido alto
🔇 silencio mudo
🎙️ microfono estudio
💡 idea bombilla
🔦 linterna
🕯️ vela
💰 dinero bolsa
💸 dinero volando gastando
💳 tarjeta credito
💎 diamante
🔧 llave herramienta
🔨 martillo
⚙️ engranaje configuracion
🔗 enlace cadena
🔒 candado cerrado
🔓 candado abierto
🔑 llave
🛡️ escudo
⚔️ espadas
🗡️ daga
💣 bomba
🧲 iman
📦 caja paquete
📫 buzon correo
✉️ sobre correo email
📝 nota memo
📌 chincheta fijar
📎 clip adjunto
✂️ tijeras
📅 calendario
⏰ despertador alarma
⏳ reloj de arena esperando
⌛ tiempo terminado
🚀 cohete lanzamiento
✈️ avion
🚗 auto coche carro
🏠 casa hogar
🏖️ playa
🗿 moai serio
❤️ corazon rojo amor
🧡 corazon naranja
💛 corazon amarillo
💚 corazon verde
💙 corazon azul
💜 corazon morado
🖤 corazon negro
🤍 corazon blanco
🤎 corazon marron
💔 corazon roto
❤️‍🔥 corazon en llamas
💕 dos corazones
💞 corazones girando
💓 corazon latiendo
💗 corazon creciendo
💖 corazon brillante
💘 corazon flecha cupido
💝 corazon regalo
💯 cien perfecto
💢 enojo
💥 explosion
💫 mareo estrella
💦 sudor gotas
💨 viento corriendo
💬 globo de dialogo
💭 pensamiento
🗯️ globo enojado
💤 sueno zzz
✅ hecho check listo
☑️ casilla marcada
✔️ check
❌ incorrecto x equis
❎ x cuadrado
⭕ circulo
🚫 prohibido
⛔ entrada prohibida
⚠️ advertencia cuidado
❓ pregunta
❔ pregunta blanca
❗ exclamacion
‼️ doble exclamacion
⁉️ exclamacion pregunta
➕ mas
➖ menos
➗ dividir
✖️ por multiplicar
♾️ infinito
🔴 circulo rojo
🟠 circulo naranja
🟡 circulo amarillo
🟢 circulo verde
🔵 circulo azul
🟣 circulo morado
⚫ circulo negro
⚪ circulo blanco
🆗 ok
🆕 nuevo
🆒 genial cool
🆙 up arriba
🔝 top
🔜 pronto soon
1️⃣ uno
2️⃣ dos
3️⃣ tres
4️⃣ cuatro
5️⃣ cinco
🔟 diez
🇧🇷 brasil
🇵🇹 portugal
🇦🇷 argentina
🇺🇸 estados_unidos eeuu usa
🇯🇵 japon
🇰🇷 corea del sur
🇩🇪 alemania
🇫🇷 francia
🇮🇹 italia
🇪🇸 espana
🇬🇧 reino_unido inglaterra
🇨🇦 canada
🇲🇽 mexico
🇺🇾 uruguay
🇨🇱 chile
🇨🇴 colombia
🏳️‍🌈 bandera arcoiris orgullo lgbt
🏴‍☠️ pirata
🏁 bandera a cuadros meta carrera
🚩 bandera roja alerta
`,
}
