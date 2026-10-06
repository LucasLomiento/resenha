<script lang="ts" module>
  // Um conjunto só (Lucide), com o mesmo traço em qualquer tamanho. Os nomes
  // são do Resenha, não do Lucide: trocar o desenho de um ícone é trocar uma linha aqui.
  import Activity from '@lucide/svelte/icons/activity'
  import AppWindow from '@lucide/svelte/icons/app-window'
  import ArrowLeft from '@lucide/svelte/icons/arrow-left'
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right'
  import AtSign from '@lucide/svelte/icons/at-sign'
  import AudioLines from '@lucide/svelte/icons/audio-lines'
  import Ban from '@lucide/svelte/icons/ban'
  import Bell from '@lucide/svelte/icons/bell'
  import BellOff from '@lucide/svelte/icons/bell-off'
  import Calendar from '@lucide/svelte/icons/calendar'
  import Camera from '@lucide/svelte/icons/camera'
  import Check from '@lucide/svelte/icons/check'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ChevronLeft from '@lucide/svelte/icons/chevron-left'
  import ChevronRight from '@lucide/svelte/icons/chevron-right'
  import CircleAlert from '@lucide/svelte/icons/circle-alert'
  import CircleCheck from '@lucide/svelte/icons/circle-check'
  import Clock from '@lucide/svelte/icons/clock'
  import Compass from '@lucide/svelte/icons/compass'
  import Copy from '@lucide/svelte/icons/copy'
  import Crown from '@lucide/svelte/icons/crown'
  import DoorOpen from '@lucide/svelte/icons/door-open'
  import Download from '@lucide/svelte/icons/download'
  import Ellipsis from '@lucide/svelte/icons/ellipsis'
  import Eye from '@lucide/svelte/icons/eye'
  import FaceSmile from '@lucide/svelte/icons/face-slightly-smiling'
  import FaceSmilePlus from '@lucide/svelte/icons/face-slightly-smiling-plus'
  import FileIcon from '@lucide/svelte/icons/file'
  import Fullscreen from '@lucide/svelte/icons/fullscreen'
  import Globe from '@lucide/svelte/icons/globe'
  import GripVertical from '@lucide/svelte/icons/grip-vertical'
  import Hash from '@lucide/svelte/icons/hash'
  import Headphones from '@lucide/svelte/icons/headphones'
  import HeadphoneOff from '@lucide/svelte/icons/headphone-off'
  import House from '@lucide/svelte/icons/house'
  import ImageIcon from '@lucide/svelte/icons/image'
  import Inbox from '@lucide/svelte/icons/inbox'
  import Info from '@lucide/svelte/icons/info'
  import Keyboard from '@lucide/svelte/icons/keyboard'
  import KeyRound from '@lucide/svelte/icons/key-round'
  import Laptop from '@lucide/svelte/icons/laptop'
  import LinkIcon from '@lucide/svelte/icons/link'
  import Lock from '@lucide/svelte/icons/lock'
  import LogIn from '@lucide/svelte/icons/log-in'
  import LogOut from '@lucide/svelte/icons/log-out'
  import Maximize from '@lucide/svelte/icons/maximize-2'
  import MessageCircle from '@lucide/svelte/icons/message-circle'
  import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus'
  import Mic from '@lucide/svelte/icons/mic'
  import MicOff from '@lucide/svelte/icons/mic-off'
  import Minimize from '@lucide/svelte/icons/minimize-2'
  import Minus from '@lucide/svelte/icons/minus'
  import Play from '@lucide/svelte/icons/play'
  import ImagePlus from '@lucide/svelte/icons/image-plus'
  import Hammer from '@lucide/svelte/icons/hammer'
  import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import Monitor from '@lucide/svelte/icons/monitor'
  import MonitorUp from '@lucide/svelte/icons/monitor-up'
  import MonitorOff from '@lucide/svelte/icons/monitor-off'
  import Moon from '@lucide/svelte/icons/moon'
  import Palette from '@lucide/svelte/icons/palette'
  import Paperclip from '@lucide/svelte/icons/paperclip'
  import Pencil from '@lucide/svelte/icons/pencil'
  import PhoneOff from '@lucide/svelte/icons/phone-off'
  import Phone from '@lucide/svelte/icons/phone'
  import PictureInPicture from '@lucide/svelte/icons/picture-in-picture-2'
  import Pin from '@lucide/svelte/icons/pin'
  import PinOff from '@lucide/svelte/icons/pin-off'
  import Plus from '@lucide/svelte/icons/plus'
  import Reply from '@lucide/svelte/icons/reply'
  import RotateCw from '@lucide/svelte/icons/rotate-cw'
  import ScrollText from '@lucide/svelte/icons/scroll-text'
  import Search from '@lucide/svelte/icons/search'
  import Settings from '@lucide/svelte/icons/settings'
  import Shield from '@lucide/svelte/icons/shield'
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal'
  import Smartphone from '@lucide/svelte/icons/smartphone'
  import Sparkles from '@lucide/svelte/icons/sparkles'
  import SquarePen from '@lucide/svelte/icons/square-pen'
  import Trash from '@lucide/svelte/icons/trash'
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert'
  import Upload from '@lucide/svelte/icons/upload'
  import User from '@lucide/svelte/icons/user'
  import UserPlus from '@lucide/svelte/icons/user-plus'
  import UserX from '@lucide/svelte/icons/user-x'
  import Users from '@lucide/svelte/icons/users'
  import Video from '@lucide/svelte/icons/video'
  import VideoOff from '@lucide/svelte/icons/video-off'
  import Volume from '@lucide/svelte/icons/volume-2'
  import VolumeOff from '@lucide/svelte/icons/volume-x'
  import X from '@lucide/svelte/icons/x'

  const ICONS = {
    activity: Activity,
    'app-window': AppWindow,
    'arrow-left': ArrowLeft,
    'arrow-up-right': ArrowUpRight,
    at: AtSign,
    'audio-lines': AudioLines,
    ban: Ban,
    bell: Bell,
    'bell-off': BellOff,
    calendar: Calendar,
    camera: Video,
    'camera-off': VideoOff,
    check: Check,
    'chevron-down': ChevronDown,
    'chevron-left': ChevronLeft,
    'chevron-right': ChevronRight,
    'circle-alert': CircleAlert,
    'circle-check': CircleCheck,
    clock: Clock,
    compass: Compass,
    copy: Copy,
    crown: Crown,
    'door-open': DoorOpen,
    download: Download,
    ellipsis: Ellipsis,
    emoji: FaceSmile,
    'emoji-plus': FaceSmilePlus,
    eye: Eye,
    file: FileIcon,
    fullscreen: Fullscreen,
    globe: Globe,
    grip: GripVertical,
    hash: Hash,
    headphones: Headphones,
    'headphones-off': HeadphoneOff,
    home: House,
    image: ImageIcon,
    inbox: Inbox,
    info: Info,
    keyboard: Keyboard,
    key: KeyRound,
    laptop: Laptop,
    link: LinkIcon,
    lock: Lock,
    'log-in': LogIn,
    'log-out': LogOut,
    maximize: Maximize,
    message: MessageCircle,
    'message-plus': MessageSquarePlus,
    mic: Mic,
    'mic-off': MicOff,
    minimize: Minimize,
    minus: Minus,
    monitor: Monitor,
    play: Play,
    'image-plus': ImagePlus,
    hammer: Hammer,
    move: ArrowRightLeft,
    'shield-check': ShieldCheck,
    moon: Moon,
    palette: Palette,
    paperclip: Paperclip,
    pencil: Pencil,
    photo: Camera,
    pin: Pin,
    'pin-off': PinOff,
    pip: PictureInPicture,
    plus: Plus,
    reply: Reply,
    restart: RotateCw,
    scroll: ScrollText,
    screen: MonitorUp,
    'screen-off': MonitorOff,
    search: Search,
    settings: Settings,
    shield: Shield,
    sliders: SlidersHorizontal,
    smartphone: Smartphone,
    sparkles: Sparkles,
    compose: SquarePen,
    'phone-off': PhoneOff,
    phone: Phone,
    trash: Trash,
    'triangle-alert': TriangleAlert,
    upload: Upload,
    user: User,
    'user-plus': UserPlus,
    'user-x': UserX,
    users: Users,
    volume: Volume,
    'volume-off': VolumeOff,
    x: X,
  } as const

  export type IconName = keyof typeof ICONS
</script>

<script lang="ts">
  let {
    name,
    size = 18,
    stroke = 1.75,
    class: className,
  }: {
    name: IconName
    /** px. Tamanhos do sistema: 14, 16, 18, 20, 24. */
    size?: number
    /** Traço em px na tela (não muda com o tamanho). */
    stroke?: number
    class?: string
  } = $props()

  const Glyph = $derived(ICONS[name])
</script>

<Glyph {size} strokeWidth={stroke} absoluteStrokeWidth class={className} aria-hidden="true" />
