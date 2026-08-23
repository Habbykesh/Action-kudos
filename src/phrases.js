// Curated, multilingual "thank you" phrase library.
// This is NOT AI-based — it's a plain phrase list, matched after normalization
// (see normalize.js). Admins can extend this per-server with /thanks add.
//
// Coverage is intentionally broad-but-not-exhaustive: it's meant to catch the
// vast majority of natural appreciation messages, with room to grow via
// /thanks add as the community's own slang shows up.

const PHRASES_BY_LANGUAGE = {
  english: [
    'thanks', 'thank you', 'thank u', 'thankyou', 'thx', 'thnx', 'ty', 'tysm',
    'tyvm', 'thanks so much', 'thank you so much', 'thanks a lot',
    'thanks a ton', 'much appreciated', 'appreciate it', 'i appreciate it',
    'i really appreciate it', 'i appreciate you', 'appreciate you',
    "you're the best", 'youre the best', 'thanks for your help',
    'thank you for helping', "you've been really helpful",
    'youve been really helpful', "you're a lifesaver", 'youre a lifesaver',
    'i am grateful', "i'm grateful", 'im grateful', 'grateful for your help',
    'cheers mate', 'big ups', 'much love for this', 'big thanks',
  ],
  french: [
    'merci', 'merci beaucoup', 'merci bcp', 'je te remercie', 'je vous remercie',
    "c'est gentil merci", 'merci pour ton aide', 'merci pour votre aide',
    'merci infiniment', 'trop merci', 'merci mille fois',
  ],
  spanish: [
    'gracias', 'muchas gracias', 'muchisimas gracias', 'te lo agradezco',
    'te agradezco', 'mil gracias', 'gracias por tu ayuda',
    'gracias por la ayuda', 'muy agradecido', 'muy agradecida',
    'se agradece', 'grax', 'graxias',
  ],
  portuguese: [
    'obrigado', 'obrigada', 'muito obrigado', 'muito obrigada', 'valeu',
    'brigado', 'brigada', 'obg', 'vlw', 'agradeco', 'agradeço',
    'obrigado pela ajuda', 'obrigada pela ajuda',
  ],
  german: [
    'danke', 'danke schön', 'danke schon', 'vielen dank', 'dankeschön',
    'ich danke dir', 'ich danke ihnen', 'danke für deine hilfe',
    'danke fur deine hilfe', 'besten dank',
  ],
  italian: [
    'grazie', 'grazie mille', 'ti ringrazio', 'la ringrazio',
    'grazie per l aiuto', 'grazie per il tuo aiuto', 'sei un grande',
  ],
  dutch: [
    'dank je', 'dank u', 'dankjewel', 'dankuwel', 'bedankt',
    'bedankt voor je hulp', 'heel erg bedankt',
  ],
  indonesian_malay: [
    'terima kasih', 'terimakasih', 'makasih', 'makasih banyak', 'trims',
    'trimakasih', 'terima kasih banyak',
  ],
  hindi: [
    'dhanyavad', 'dhanyavaad', 'shukriya', 'bahut shukriya', 'bahut dhanyavad',
    'thanku bhai', 'धन्यवाद', 'शुक्रिया',
  ],
  bengali: [
    'dhonnobad', 'dhonnobaad', 'ধন্যবাদ',
  ],
  tamil: [
    'nandri', 'romba nandri', 'நன்றி',
  ],
  telugu: [
    'dhanyavadalu', 'ధన్యవాదాలు',
  ],
  marathi: [
    'dhanyavad', 'धन्यवाद',
  ],
  gujarati: [
    'aabhar', 'આભાર',
  ],
  punjabi: [
    'dhanwad', 'shukriya', 'ਧੰਨਵਾਦ',
  ],
  kannada: [
    'dhanyavadagalu', 'ಧನ್ಯವಾದಗಳು',
  ],
  malayalam: [
    'nandi', 'നന്ദി',
  ],
  chinese: [
    '谢谢', '謝謝', '谢谢你', '謝謝你', '多谢', '多謝', '感谢', '感謝', 'xiexie',
    'xie xie',
  ],
  japanese: [
    'ありがとう', 'ありがとうございます', '感謝します', 'arigatou', 'arigato gozaimasu',
    'domo arigato',
  ],
  korean: [
    '감사합니다', '고맙습니다', '고마워', '감사해요', 'gamsahamnida', 'gomawo',
  ],
  arabic: [
    'شكرا', 'شكرا لك', 'شكرا جزيلا', 'يعطيك العافية', 'shukran',
    'shukran jazilan',
  ],
  turkish: [
    'teşekkürler', 'tesekkurler', 'teşekkür ederim', 'tesekkur ederim',
    'çok teşekkürler', 'cok tesekkurler', 'sağ ol', 'sag ol',
  ],
  russian: [
    'спасибо', 'спасибо большое', 'благодарю', 'спс', 'spasibo',
  ],
  ukrainian: [
    'дякую', 'дуже дякую', 'дякую тобі', 'diakuyu',
  ],
  polish: [
    'dziękuję', 'dziekuje', 'dzięki', 'dzieki', 'bardzo dziękuję',
  ],
  greek: [
    'ευχαριστώ', 'ευχαριστώ πολύ', 'efharisto', 'efxaristo',
  ],
  vietnamese: [
    'cảm ơn', 'cam on', 'cảm ơn bạn', 'cam on ban', 'cảm ơn nhiều',
  ],
  thai: [
    'ขอบคุณ', 'ขอบคุณมาก', 'khob khun', 'kob khun ka', 'kob khun krub',
  ],
  filipino: [
    'salamat', 'maraming salamat', 'salamat po', 'salamat sa tulong',
  ],
  persian: [
    'ممنون', 'متشکرم', 'خیلی ممنون', 'mamnoon', 'merci ازت',
  ],
  hebrew: [
    'תודה', 'תודה רבה', 'toda', 'toda raba',
  ],
  yoruba: [
    'e se', 'e se pupo', 'ese',
  ],
  igbo: [
    'daalu', 'imela', 'daalu nke ukwuu',
  ],
};

const BASE_PHRASES = Object.values(PHRASES_BY_LANGUAGE).flat();

module.exports = { PHRASES_BY_LANGUAGE, BASE_PHRASES };
