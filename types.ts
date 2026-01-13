
export enum Role {
  USER = 'user',
  GEM = 'gem',
}

export interface Message {
  role: Role;
  content: string;
}
