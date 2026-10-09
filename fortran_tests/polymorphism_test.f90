program polymorphism_test
    use shapes
    implicit none
    class(shape), allocatable :: my_shape

    allocate (square :: my_shape)
    select type (s => my_shape)
    type is (square)
        s%side = 4.0
    end select

    print *, "Polymorphic Area:", my_shape%get_area()

    if (abs(my_shape%get_area() - 16.0) > 1e-6) stop 2
    print *, "Allocation & Polymorphism: OK"
end
