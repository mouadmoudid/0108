import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

// POST /api/admin/laundries/[laundryId]/suspend
export async function POST(
  request: NextRequest,
  { params }: { params: { laundryId: string } }
) {
  try {
    const { laundryId } = params
    const body = await request.json()
    const { reason } = body

    // Check if laundry exists
    const laundry = await prisma.laundry.findUnique({
      where: { id: laundryId }
    })

    if (!laundry) {
      return errorResponse('Laundry not found', 404)
    }

    if (laundry.status === 'SUSPENDED') {
      return errorResponse('Laundry is already suspended', 400)
    }

    // Update laundry status to suspended
    const updatedLaundry = await prisma.laundry.update({
      where: { id: laundryId },
      data: {
        status: 'SUSPENDED',
        updatedAt: new Date()
      },
      include: {
        admin: {
          select: {
            name: true,
            email: true
          }
        }
      }
    })

    // Create activity log
    await prisma.activity.create({
      data: {
        type: 'LAUNDRY_SUSPENDED',
        title: 'Laundry suspended',
        description: `Laundry ${updatedLaundry.name} has been suspended`,
        laundryId: laundryId,
        metadata: {
          reason: reason || 'No reason provided',
          suspendedBy: 'Super Admin',
          previousStatus: laundry.status
        }
      }
    })

    // Cancel all pending/confirmed orders for this laundry
    await prisma.order.updateMany({
      where: {
        laundryId: laundryId,
        status: {
          in: ['PENDING', 'CONFIRMED']
        }
      },
      data: {
        status: 'CANCELED',
        updatedAt: new Date()
      }
    })

    return successResponse(
      {
        id: updatedLaundry.id,
        name: updatedLaundry.name,
        status: updatedLaundry.status,
        suspendedAt: updatedLaundry.updatedAt,
        admin: updatedLaundry.admin
      },
      'Laundry suspended successfully'
    )
  } catch (error) {
    console.error('Suspend laundry error:', error)
    return errorResponse('Failed to suspend laundry', 500)
  }
}