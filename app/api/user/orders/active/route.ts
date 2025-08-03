// app/api/user/orders/active/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { NextRequest } from 'next/server'

// GET /api/user/orders/active?userId=xxx
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }

    const activeOrders = await prisma.order.findMany({
      where: { 
        customerId: userId,
        status: { 
          in: ['PENDING', 'CONFIRMED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'] 
        }
      },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        finalAmount: true,
        createdAt: true,
        pickupDate: true,
        deliveryDate: true,
        laundry: {
          select: {
            name: true,
            logo: true,
            phone: true
          }
        },
        address: {
          select: {
            street: true,
            city: true,
            state: true
          }
        },
        _count: {
          select: {
            orderItems: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const formattedOrders = activeOrders.map(order => ({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      placedDate: order.createdAt,
      itemCount: order._count.orderItems,
      totalCost: order.finalAmount,
      estimatedDelivery: order.deliveryDate,
      laundry: order.laundry,
      deliveryAddress: `${order.address.street}, ${order.address.city}, ${order.address.state}`
    }))

    return successResponse(formattedOrders, 'Active orders retrieved successfully')
  } catch (error) {
    console.error('Get active orders error:', error)
    return errorResponse('Failed to retrieve active orders', 500)
  }
}