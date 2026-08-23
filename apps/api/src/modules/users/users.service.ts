import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateDoctorDto, UpdateDoctorDto } from '@healthcare/contracts';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async createDoctor(dto: CreateDoctorDto) {
    const passwordHash = await argon2.hash(dto.password);

    try {
      const user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          role: 'doctor',
          fullName: dto.fullName,
          phone: dto.phone,
          doctor: {
            create: {
              specialisationId: dto.specialisationId,
              registrationNo: dto.registrationNo,
              qualification: dto.qualification,
              consultationFee: dto.consultationFee ?? 0,
              slotDurationMin: dto.slotDurationMin ?? 30,
              bufferMin: dto.bufferMin ?? 0,
            },
          },
        },
        include: {
          doctor: { include: { specialisation: true } },
        },
      });

      return this.formatDoctor(user);
    } catch (error: any) {
      if (error.code === 'P2002') {
        throw new ConflictException({
          code: 'DUPLICATE_EMAIL',
          title: 'Email already registered',
          detail: 'A user with this email address already exists.',
        });
      }
      throw error;
    }
  }

  async updateDoctor(doctorId: string, dto: UpdateDoctorDto) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { userId: doctorId },
    });

    if (!doctor) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Doctor not found',
      });
    }

    const updated = await this.prisma.user.update({
      where: { id: doctorId },
      data: {
        fullName: dto.fullName,
        phone: dto.phone,
        doctor: {
          update: {
            specialisationId: dto.specialisationId,
            registrationNo: dto.registrationNo,
            qualification: dto.qualification,
            consultationFee: dto.consultationFee,
            slotDurationMin: dto.slotDurationMin,
            bufferMin: dto.bufferMin,
          },
        },
      },
      include: {
        doctor: { include: { specialisation: true } },
      },
    });

    return this.formatDoctor(updated);
  }

  async findDoctors(filters: { specialisation?: string; q?: string }) {
    const where: any = {
      role: 'doctor',
      isActive: true,
      doctor: {
        isAcceptingBookings: true,
      },
    };

    if (filters.specialisation) {
      where.doctor.specialisation = { name: filters.specialisation };
    }

    if (filters.q) {
      where.fullName = { contains: filters.q, mode: 'insensitive' };
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        doctor: { include: { specialisation: true } },
      },
      orderBy: { fullName: 'asc' },
    });

    return users.map(this.formatDoctor);
  }

  async findDoctorById(doctorId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: doctorId, role: 'doctor' },
      include: {
        doctor: { include: { specialisation: true } },
      },
    });

    if (!user) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        title: 'Doctor not found',
      });
    }

    return this.formatDoctor(user);
  }

  private formatDoctor(user: any) {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      specialisation: user.doctor?.specialisation?.name,
      specialisationId: user.doctor?.specialisationId,
      registrationNo: user.doctor?.registrationNo,
      qualification: user.doctor?.qualification,
      consultationFee: user.doctor?.consultationFee,
      slotDurationMin: user.doctor?.slotDurationMin,
      bufferMin: user.doctor?.bufferMin,
      isAcceptingBookings: user.doctor?.isAcceptingBookings,
    };
  }
}
