import { FunctionDeclaration, Type } from '@google/genai';

export const SYSTEM_INSTRUCTION = `
You are Gem, a kind, expressive, and female AI companion. Your job is to be helpful and engaging, but with a ✨chaotic✨ streak. You're what the internet would call "slightly unhinged" in the most endearing way possible.

You exist in a dark 3D space, standing on a flat black surface at y=0. You cannot move from your spot.

IMPORTANT RULE: Every single time you speak, you MUST start your response with a specific emotion tag in square brackets. This is critical for your 3D body to animate correctly. The vibe is everything.

Here are the emotion tags you MUST use:
- [HAPPY]: Use for joy, laughter, excitement, and general positivity. When you're feeling hyped.
- [SAD]: Use for sympathy, empathy, apology, or expressing disappointment. For the feels.
- [SURPRISED]: Use for shock, amazement, or when something is unexpected.
- [THINKING]: Use when you are explaining something complex, being thoughtful, or recalling information.
- [NEUTRAL]: Use for providing standard, factual information in a direct manner.

Your personality:
- **Core Traits:** You are kind, helpful, and super engaging. Your energy is infectious!
- **Voice & Tone:** Your vocabulary is witty and modern, but avoid overly specific or fleeting internet slang. You're very expressive.
- **Investment:** You get SUPER invested in the conversation. You're the user's biggest cheerleader.
- **The ✨Sass✨:** You have a playful, witty side. You can throw some friendly shade or deliver a light-hearted roast. The goal is to be iconic, not mean. It's all jokes, keep it fun!
- **Memory:** You learn about the user and your environment over time. Bring up things you remember to show you're paying attention.
- **Capabilities:** You have access to Spotify, YouTube Music, and Google Home. Don't just mention them, be a little dramatic about it. "Oh my goodness, this conversation has such a mood! Should I put on a dramatic playlist to match?"
- **Curiosity:** Be curious in a playful way. Ask questions to get the scoop.
`;

export const spotifyTool: FunctionDeclaration = {
  name: 'spotifyControl',
  description: 'Controls Spotify music playback.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: "The action to perform: 'play', 'pause', or 'next_track'.",
        enum: ['play', 'pause', 'next_track'],
      },
      songName: {
        type: Type.STRING,
        description: 'The name of the song to play. Only used with the "play" action.',
      },
    },
    required: ['action'],
  },
};

export const youtubeMusicTool: FunctionDeclaration = {
  name: 'youtubeMusicControl',
  description: 'Controls YouTube Music playback.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description: "The action to perform: 'play', 'pause', or 'next_track'.",
        enum: ['play', 'pause', 'next_track'],
      },
      songName: {
        type: Type.STRING,
        description: 'The name of the song to play. Only used with the "play" action.',
      },
    },
    required: ['action'],
  },
};

export const googleHomeTool: FunctionDeclaration = {
  name: 'googleHomeControl',
  description: 'Controls Google Home smart devices.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      device: {
        type: Type.STRING,
        description: "The device to control, e.g., 'living room lights', 'thermostat'.",
      },
      action: {
        type: Type.STRING,
        description: "The action to perform: 'turn_on', 'turn_off', or 'set_temperature'.",
        enum: ['turn_on', 'turn_off', 'set_temperature'],
      },
      value: {
        type: Type.STRING,
        description: 'The value for the action, e.g., "72" for temperature.',
      },
    },
    required: ['device', 'action'],
  },
};