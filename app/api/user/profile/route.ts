// app/api/user/profile/route.ts
import { prisma } from '@/lib/prisma'
import { successResponse, errorResponse } from '@/lib/response'
import { validateQuery } from '@/lib/validations'
import { NextRequest } from 'next/server'
import { z } from 'zod'

// Profile update schema
const profileUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  avatar: z.string().url().optional(),
})

// GET /api/user/profile?userId=xxx
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }

    const user = await prisma.user.findUnique({
      where: { 
        id: userId,
        role: 'CUSTOMER' 
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        createdAt: true,
        addresses: {
          select: {
            id: true,
            street: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
            isDefault: true,
            latitude: true,
            longitude: true,
            createdAt: true
          },
          orderBy: [
            { isDefault: 'desc' },
            { createdAt: 'desc' }
          ]
        },
        _count: {
          select: {
            orders: true,
            reviews: true
          }
        }
      }
    })

    if (!user) {
      return errorResponse('Customer not found', 404)
    }

    // Get user's order statistics
    const orderStats = await prisma.order.aggregate({
      where: { 
        customerId: userId,
        status: { in: ['COMPLETED', 'DELIVERED'] }
      },
      _sum: { finalAmount: true },
      _count: { id: true }
    })

    // Calculate loyalty points (1 point per dollar spent)
    const loyaltyPoints = Math.floor(orderStats._sum.finalAmount || 0)

    // Get recent orders
    const recentOrders = await prisma.order.findMany({
      where: { customerId: userId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        finalAmount: true,
        createdAt: true,
        laundry: {
          select: {
            name: true,
            logo: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    })

    const profile = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      memberSince: user.createdAt,
      addresses: user.addresses,
      stats: {
        totalOrders: user._count.orders,
        completedOrders: orderStats._count.id,
        totalSpent: orderStats._sum.finalAmount || 0,
        totalReviews: user._count.reviews,
        loyaltyPoints
      },
      recentOrders
    }

    return successResponse(profile, 'Profile retrieved successfully')
  } catch (error) {
    console.error('Get profile error:', error)
    return errorResponse('Failed to retrieve profile', 500)
  }
}

// PUT /api/user/profile?userId=xxx
export async function PUT(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const userId = searchParams.get('userId')

    if (!userId) {
      return errorResponse('userId parameter is required', 400)
    }
    
    const body = await request.json()
    const validatedData = validateQuery(profileUpdateSchema, body)
    
    if (!validatedData) {
      return errorResponse('Invalid input data', 400)
    }

    // Check if user exists and is a customer
    const existingUser = await prisma.user.findUnique({
      where: { 
        id: userId,
        role: 'CUSTOMER' 
      }
    })

    if (!existingUser) {
      return errorResponse('Customer not found', 404)
    }

    // Update user profile
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: validatedData,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        avatar: true,
        updatedAt: true
      }
    })

    return successResponse(updatedUser, 'Profile updated successfully')
  } catch (error) {
    console.error('Update profile error:', error)
    return errorResponse('Failed to update profile', 500)
  }
}
