import { IsUUID } from 'class-validator';

export class AddCrewMemberDto {
  @IsUUID()
  workerId!: string;
}
