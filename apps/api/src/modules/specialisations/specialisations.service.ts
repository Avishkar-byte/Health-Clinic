import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class SpecialisationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.specialisation.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { doctors: true } },
      },
    });
  }
}
